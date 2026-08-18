// Assistant RAG: unified query endpoint + knowledge-base document management.
// POST   /api/assistant/query               any authenticated user
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
  listConversations,
  resolveConversation,
  saveMessage,
} from "./_shared/conversations";
import {
  classifyIntent,
  detectLanguage,
  generateAnswer,
  getScoreBreakdown,
  ingestDocumentText,
  candidateEmptyAnswer,
  retrieveCandidates,
  retrieveDocChunks,
} from "./_shared/rag";

export const config = {
  path: [
    "/api/assistant/chat",
    "/api/assistant/conversations",
    "/api/assistant/conversations/:id",
    "/api/assistant/query",
    "/api/assistant/documents",
    "/api/assistant/documents/:name",
  ],
};

// Conversation en flux (SSE). Chaque événement est une ligne `data: {json}`.
// Le format one-shot /query est conservé pour compatibilité.
async function handleChat(req: Request, userId: string): Promise<Response> {
  const body = await readBody(req);
  const history = sanitizeHistory(body.messages);
  if (!history.length) return fail("Conversation vide");
  const last = history[history.length - 1];
  if (last.role !== "user") {
    return fail("Le dernier message doit venir de l'utilisateur");
  }

  const conversationId = await resolveConversation(
    userId,
    body.conversation_id != null ? Number(body.conversation_id) : null,
    last.content,
  );
  await saveMessage(conversationId, { role: "user", content: last.content });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      // Le fil est annoncé en premier : le client peut le retenir même si la
      // génération échoue ensuite.
      send({ type: "conversation", conversation_id: conversationId });
      let answer = "";
      const tools: string[] = [];
      let sources: unknown[] = [];
      try {
        for await (const event of runAgent(history)) {
          if (event.type === "delta") answer += event.text;
          else if (event.type === "tool") tools.push(event.name);
          else if (event.type === "sources") sources = event.sources;
          send(event);
        }
        if (answer.trim()) {
          await saveMessage(conversationId, {
            role: "assistant",
            content: answer,
            tools,
            sources,
          });
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Erreur de l'assistant",
        });
        send({ type: "done" });
      } finally {
        controller.close();
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

async function handleQuery(req: Request): Promise<Response> {
  const body = await readBody(req);
  const query = String(body.query ?? "").trim();
  if (query.length < 2) return fail("Question trop courte");
  const assignmentId = body.assignment_id != null ? Number(body.assignment_id) : null;
  const topK = Math.min(20, Math.max(1, Number(body.top_k ?? 5)));

  const intent = await classifyIntent(query, assignmentId);

  if (intent === "matching_explanation") {
    if (assignmentId == null) {
      return json({
        intent,
        answer:
          detectLanguage(query) === "fr"
            ? "Précisez l'affectation concernée (assignment_id) pour obtenir l'explication du score."
            : "Provide the assignment_id of the assignment to explain its score.",
        sources: [],
      });
    }
    const result = await getScoreBreakdown(assignmentId);
    return json({
      intent,
      answer: await generateAnswer(intent, query, result),
      sources: result ? [result] : [],
    });
  }

  if (intent === "candidate_search") {
    const { results, diag } = await retrieveCandidates(query, {
      minYearsExperience: body.min_years_experience != null ? Number(body.min_years_experience) : null,
      educationLevel: body.education_level ?? null,
      topK,
    });
    // An empty result explains which filter removed the candidates rather than
    // leaving the recruiter to guess.
    const answer = results.length
      ? await generateAnswer(intent, query, results)
      : candidateEmptyAnswer(diag, detectLanguage(query));
    return json({ intent, answer, sources: results, diagnostic: diag });
  }

  const results = await retrieveDocChunks(query, topK);
  return json({ intent, answer: await generateAnswer(intent, query, results), sources: results });
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

  const sourceDocument = String(form.get("title") ?? "").trim() || file.name || "document";
  const data = new Uint8Array(await file.arrayBuffer());
  const text = await extractCvText(data, file.name);
  if (!text.trim()) return fail("Aucun texte extrait du document");

  // Chunking + insertion are fast without embeddings — run synchronously.
  const chunks = await ingestDocumentText(sourceDocument, text);
  return json({ source_document: sourceDocument, task_id: "sync", status: "ingested", chunks }, 202);
}

async function listDocuments(): Promise<Response> {
  const sb = admin();
  const { data, error } = await sb.from("document_chunks").select("source_document");
  if (error) return fail(error.message, 500);
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    counts.set(r.source_document, (counts.get(r.source_document) ?? 0) + 1);
  }
  return json(
    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source_document, chunks]) => ({ source_document, chunks })),
  );
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

  if (pathname.endsWith("/chat")) {
    const user = await requireUser(req);
    if (user instanceof Response) return user;
    if (req.method !== "POST") return methodNotAllowed();
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

  if (pathname.endsWith("/query")) {
    const user = await requireUser(req);
    if (user instanceof Response) return user;
    if (req.method !== "POST") return methodNotAllowed();
    return handleQuery(req);
  }

  // Knowledge-base management is staff-only.
  const user = await requireStaff(req);
  if (user instanceof Response) return user;

  const name = ctx.params?.name;
  if (name) {
    if (req.method !== "DELETE") return methodNotAllowed();
    return deleteDocument(decodeURIComponent(name));
  }
  if (req.method === "GET") return listDocuments();
  if (req.method === "POST") return handleUpload(req);
  return methodNotAllowed();
};
