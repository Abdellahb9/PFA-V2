// Assistant RAG: unified query endpoint + knowledge-base document management.
// POST   /api/assistant/query               any authenticated user
// GET    /api/assistant/documents           staff
// POST   /api/assistant/documents           staff (multipart: file [+ title])
// DELETE /api/assistant/documents/:name     staff
import { admin } from "./_shared/supabase";
import { requireStaff, requireUser } from "./_shared/auth";
import { json, fail, noContent, methodNotAllowed, readBody } from "./_shared/http";
import { extractCvText } from "./_shared/cv";
import {
  classifyIntent,
  detectLanguage,
  generateAnswer,
  getScoreBreakdown,
  ingestDocumentText,
  retrieveCandidates,
  retrieveDocChunks,
} from "./_shared/rag";

export const config = {
  path: ["/api/assistant/query", "/api/assistant/documents", "/api/assistant/documents/:name"],
};

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
    const results = await retrieveCandidates(query, {
      minYearsExperience: body.min_years_experience != null ? Number(body.min_years_experience) : null,
      educationLevel: body.education_level ?? null,
      topK,
    });
    return json({ intent, answer: await generateAnswer(intent, query, results), sources: results });
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
