// Assistant RAG : conversation en flux + gestion de la base documentaire.
// POST   /api/assistant/chat                staff (l'assistant lit toute la base)
// GET    /api/assistant/conversations[/:id] fils de l'appelant uniquement
// GET    /api/assistant/documents           staff
// POST   /api/assistant/documents           staff (multipart: file [+ title, doc_type, replace])
// DELETE /api/assistant/documents/:name     staff
import { admin } from "./_shared/supabase";
import { requireStaff, requireUser } from "./_shared/auth";
import { json, fail, noContent, methodNotAllowed, readBody } from "./_shared/http";
import { classifyScope, refusalStream } from "./_shared/scope";
import { triggerEmbedding } from "./_shared/trigger-analysis";
import {
  getConversation,
  getHistory,
  listConversations,
  resolveConversation,
  saveMessage,
} from "./_shared/conversations";
import {
  ALLOWED_EXTENSIONS,
  DocumentExistsError,
  EmptyDocumentError,
  getStore,
  guessDocType,
  ingestDocument,
  isDocType,
  MAX_UPLOAD_BYTES,
  runAgent,
  sanitizeHistory,
} from "./_shared/rag";

export const config = {
  path: [
    "/api/assistant/chat",
    "/api/assistant/conversations",
    "/api/assistant/conversations/:id",
    "/api/assistant/documents",
    "/api/assistant/documents/:name",
  ],
};

// Un message coûte jusqu'à 5 appels LLM facturés plus autant de recherches.
// Sans plafond, un seul compte peut vider le quota.
const RATE_LIMIT_PER_HOUR = 60;
// Marge pour l'enveloppe multipart (frontières, en-têtes, champs texte).
const MULTIPART_OVERHEAD = 64 * 1024;

async function checkRateLimit(userId: string): Promise<Response | null> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await admin()
    .from("assistant_messages")
    .select("id, conversation:assistant_conversations!inner(user_id)", {
      count: "exact",
      head: true,
    })
    .eq("role", "user")
    .eq("conversation.user_id", userId)
    .gte("created_at", since);
  // Le compteur ne doit jamais bloquer l'assistant s'il échoue lui-même.
  if (error) {
    console.error("rate limit check failed:", error.message);
    return null;
  }
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return fail(
      `Trop de questions à l'assistant (${RATE_LIMIT_PER_HOUR}/heure). Réessayez plus tard.`,
      429,
    );
  }
  return null;
}

// ---- Conversation (SSE) --------------------------------------------------------------

async function handleChat(req: Request, userId: string): Promise<Response> {
  const body = await readBody(req);
  // Le client n'envoie QUE son nouveau message ; les tours précédents sont relus
  // en base. Un historique fourni par le navigateur permettrait de forger de
  // faux tours « assistant ».
  const message = String(body.message ?? "").trim();
  if (!message) return fail("Message vide");

  const conversationId = await resolveConversation(
    userId,
    body.conversation_id != null ? Number(body.conversation_id) : null,
    message,
  );
  const history = sanitizeHistory([
    ...(await getHistory(userId, conversationId)),
    { role: "user", content: message },
  ]);
  await saveMessage(conversationId, { role: "user", content: message });

  // Filtre de périmètre AVANT l'agent : une question hors recrutement, ou une
  // demande de classement discriminatoire, n'atteint jamais le modèle principal.
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content;
  const scope = await classifyScope(message, lastAssistant);
  if (scope.verdict !== "in") {
    console.info(`assistant: question refusée (${scope.verdict}, via ${scope.via})`);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Le client peut couper le flux à tout moment : on absorbe l'écriture ratée.
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client parti */
        }
      };
      // Le fil est annoncé en premier : le client le retient même en cas d'échec.
      send({ type: "conversation", conversation_id: conversationId });
      let answer = "";
      const tools: string[] = [];
      let sources: unknown[] = [];
      try {
        const events =
          scope.verdict === "in" ? runAgent(history, req.signal) : refusalStream(scope.verdict);
        for await (const event of events) {
          if (event.type === "delta") answer += event.text;
          else if (event.type === "tool") tools.push(event.name);
          else if (event.type === "sources") sources = event.sources;
          send(event);
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Erreur de l'assistant",
        });
        send({ type: "done" });
      } finally {
        // Une réponse partielle vaut mieux qu'un tour perdu.
        if (answer.trim()) {
          await saveMessage(conversationId, { role: "assistant", content: answer, tools, sources });
        }
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

// ---- Base documentaire --------------------------------------------------------------

async function handleUpload(req: Request): Promise<Response> {
  // Refuser AVANT de lire le corps : formData() met tout le fichier en mémoire.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
    return fail(`Fichier trop volumineux (maximum ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo)`, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Requête multipart invalide");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Fichier manquant ou vide");
  if (!ALLOWED_EXTENSIONS.test(file.name || "")) {
    return fail("Format non supporté (PDF, DOCX, TXT ou MD attendu)", 415);
  }
  // Le Content-Length peut manquer (transfert par morceaux) : on revérifie.
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(`Fichier trop volumineux (maximum ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo)`, 413);
  }

  const name = String(form.get("title") ?? "").trim() || file.name || "document";
  const requested = String(form.get("doc_type") ?? "").trim();
  const docType = isDocType(requested) ? requested : guessDocType(name, file.name);
  const replace = String(form.get("replace") ?? "") === "true";

  try {
    const result = await ingestDocument({
      name,
      data: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      docType,
      replace,
    });
    if (result.embeddings === "pending") triggerEmbedding(req);
    return json({ ...result, status: "ingested" });
  } catch (err) {
    // L'existence est vérifiée dans la transaction d'écriture : pas de course possible.
    if (err instanceof DocumentExistsError) return fail(err.message, 409);
    if (err instanceof EmptyDocumentError) return fail(err.message);
    console.error("document ingestion failed:", err);
    return fail(err instanceof Error ? err.message : "Échec de l'ingestion", 500);
  }
}

async function listDocuments(): Promise<Response> {
  try {
    return json(await getStore().listDocuments());
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Erreur base documentaire", 500);
  }
}

async function deleteDocument(name: string): Promise<Response> {
  try {
    return (await getStore().deleteDocument(name)) ? noContent() : fail("Document introuvable", 404);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Erreur base documentaire", 500);
  }
}

// ---- Routage -----------------------------------------------------------------------

export default async (req: Request, ctx: { params?: Record<string, string> }): Promise<Response> => {
  const { pathname } = new URL(req.url);

  // L'assistant interroge TOUTE la base (profils, réservations, scores) : il est
  // réservé au personnel.
  if (pathname.endsWith("/chat")) {
    const user = await requireStaff(req);
    if (user instanceof Response) return user;
    if (req.method !== "POST") return methodNotAllowed();
    const limited = await checkRateLimit(user.id);
    if (limited) return limited;
    return handleChat(req, user.id);
  }

  // Fils de conversation : strictement ceux de l'appelant.
  if (pathname.includes("/conversations")) {
    const user = await requireUser(req);
    if (user instanceof Response) return user;
    if (req.method !== "GET") return methodNotAllowed();
    const id = ctx.params?.id;
    if (id) {
      const conv = await getConversation(user.id, Number(id));
      return conv ? json(conv) : fail("Conversation introuvable", 404);
    }
    return json(await listConversations(user.id));
  }

  // Gestion de la base documentaire : personnel uniquement.
  const user = await requireStaff(req);
  if (user instanceof Response) return user;

  const name = ctx.params?.name;
  if (name) {
    if (req.method !== "DELETE") return methodNotAllowed();
    let decoded: string;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      return fail("Nom de document invalide");
    }
    return deleteDocument(decoded);
  }
  if (req.method === "GET") return listDocuments();
  if (req.method === "POST") return handleUpload(req);
  return methodNotAllowed();
};
