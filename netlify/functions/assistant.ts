// Assistant RAG : conversation en flux + gestion de la base documentaire.
// POST   /api/assistant/chat                staff (l'assistant lit toute la base)
// GET    /api/assistant/conversations       fils de l'appelant uniquement
// GET    /api/assistant/documents           staff
// POST   /api/assistant/documents           staff (multipart: file [+ title])
// DELETE /api/assistant/documents/:name     staff
import { admin } from "./_shared/supabase";
import { requireStaff, requireUser } from "./_shared/auth";
import { json, fail, noContent, methodNotAllowed, readBody } from "./_shared/http";
import { extractCvText } from "./_shared/cv";
import { runAgent, sanitizeHistory } from "./_shared/agent";
import {
  getConversation,
  getHistory,
  listConversations,
  resolveConversation,
  saveMessage,
} from "./_shared/conversations";
import { ingestDocumentText, listDocumentCounts } from "./_shared/rag";

export const config = {
  path: [
    "/api/assistant/chat",
    "/api/assistant/conversations",
    "/api/assistant/conversations/:id",
    "/api/assistant/documents",
    "/api/assistant/documents/:name",
  ],
};

// Un message d'assistant coûte jusqu'à 5 appels LLM facturés plus autant de
// requêtes de recherche. Sans plafond, un seul compte peut vider le quota.
const RATE_LIMIT_PER_HOUR = 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

// Conversation en flux (SSE). Chaque événement est une ligne `data: {json}`.
async function handleChat(req: Request, userId: string): Promise<Response> {
  const body = await readBody(req);
  // Le client n'envoie QUE son nouveau message. Les tours précédents sont relus
  // en base : un historique fourni par le navigateur permettrait de forger de
  // faux tours « assistant » et donc de dicter au modèle ce qu'il a « déjà dit ».
  const message = String(body.message ?? "").trim();
  if (!message) return fail("Message vide");

  const conversationId = await resolveConversation(
    userId,
    body.conversation_id != null ? Number(body.conversation_id) : null,
    message,
  );
  // getHistory refiltre sur user_id : un id deviné ne donne pas le fil d'autrui.
  // sanitizeHistory borne ensuite la taille — un tour enregistré n'a pas de
  // limite de longueur en base, et rien ne doit gonfler le contexte sans borne.
  const history = sanitizeHistory([
    ...(await getHistory(userId, conversationId)),
    { role: "user", content: message },
  ]);
  await saveMessage(conversationId, { role: "user", content: message });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Le flux peut être coupé par le client à tout moment : une écriture sur
      // un contrôleur fermé lève, y compris depuis le `catch`. On absorbe.
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client parti : plus rien à diffuser */
        }
      };
      // Le fil est annoncé en premier : le client peut le retenir même si la
      // génération échoue ensuite.
      send({ type: "conversation", conversation_id: conversationId });
      let answer = "";
      const tools: string[] = [];
      let sources: unknown[] = [];
      try {
        for await (const event of runAgent(history, req.signal)) {
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
        // Une réponse partielle vaut mieux qu'un tour perdu : on enregistre ce
        // qui a été produit, même si le flux s'est interrompu en cours de route.
        if (answer.trim()) {
          await saveMessage(conversationId, {
            role: "assistant",
            content: answer,
            tools,
            sources,
          });
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
      // Empêche la bufferisation par un proxy intermédiaire.
      "x-accel-buffering": "no",
    },
  });
}

async function handleUpload(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Requête multipart invalide");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Fichier manquant ou vide");
  const name = (file.name || "").toLowerCase();
  if (!/\.(pdf|docx|txt)$/.test(name)) {
    return fail("Format non supporté (PDF, DOCX ou TXT attendu)", 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(`Fichier trop volumineux (maximum ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo)`, 413);
  }

  const sourceDocument = String(form.get("title") ?? "").trim() || file.name || "document";
  // Réutiliser un titre existant remplaçait silencieusement les extraits d'un
  // autre document. On l'exige explicitement plutôt que de le deviner.
  if (String(form.get("replace") ?? "") !== "true") {
    const { count } = await admin()
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("source_document", sourceDocument);
    if (count) {
      return fail(
        `Un document nommé « ${sourceDocument} » existe déjà. Renommez-le, ou renvoyez la ` +
          `requête avec replace=true pour le remplacer.`,
        409,
      );
    }
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const text = await extractCvText(data, file.name);
  if (!text.trim()) return fail("Aucun texte extrait du document");

  // Découpage + insertion sont rapides sans embeddings : traitement synchrone,
  // donc 200 et non 202 — il n'y a aucune tâche de fond à suivre.
  const chunks = await ingestDocumentText(sourceDocument, text);
  return json({ source_document: sourceDocument, status: "ingested", chunks });
}

async function listDocuments(): Promise<Response> {
  // Le comptage se fait en SQL : ramener toutes les lignes pour les compter en
  // JS plafonnait à la limite de lignes de PostgREST, ce qui faussait les
  // totaux et pouvait faire disparaître un document entier de la liste.
  try {
    return json(await listDocumentCounts());
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Erreur base documentaire", 500);
  }
}

async function deleteDocument(name: string): Promise<Response> {
  const sb = admin();
  const { data, error } = await sb
    .from("document_chunks")
    .delete()
    .eq("source_document", name)
    .select("id");
  if (error) return fail(error.message, 500);
  if (!data?.length) return fail("Document introuvable", 404);
  return noContent();
}

export default async (req: Request, ctx: { params?: Record<string, string> }): Promise<Response> => {
  const { pathname } = new URL(req.url);

  // L'assistant interroge TOUTE la base (profils, réservations, scores) : il est
  // réservé au personnel. Un candidat authentifié y lisait les profils de ses
  // concurrents, leurs universités et leurs affectations.
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

  // Knowledge-base management is staff-only.
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
