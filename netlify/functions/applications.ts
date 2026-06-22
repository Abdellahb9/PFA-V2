// /api/applications  ·  /api/applications/:id  ·  /api/applications/:id/:action
// Admin: list, delete (cascade + storage cleanup), status update, reanalyze,
// signed CV url.
import type { Context } from "@netlify/functions";
import { admin, BUCKET } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail, noContent, readBody } from "./_shared/http";

export const config = {
  path: ["/api/applications", "/api/applications/:id", "/api/applications/:id/:action"],
};

const SELECT =
  "id, candidate_id, offer_id, status, motivation, match_score, parsed_at, created_at, " +
  "candidate:candidates(id, first_name, last_name, email, education_level, field_of_study, " +
  "candidate_skills(weight, skill:skills(name))), documents(id, kind, filename, content_type, size)";

function serialize(a: any) {
  const c = a.candidate;
  const candidate = c
    ? {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        full_name: `${c.first_name} ${c.last_name}`.trim(),
        email: c.email,
        education_level: c.education_level,
        field_of_study: c.field_of_study,
        skills: (c.candidate_skills ?? [])
          .map((cs: any) => ({ name: cs.skill?.name, weight: cs.weight }))
          .filter((s: any) => s.name),
        has_embedding: false,
        years_experience: 0,
      }
    : null;
  return {
    id: a.id,
    candidate_id: a.candidate_id,
    offer_id: a.offer_id,
    status: a.status,
    motivation: a.motivation,
    match_score: a.match_score,
    parsed_at: a.parsed_at,
    created_at: a.created_at,
    candidate,
    documents: a.documents ?? [],
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  const sb = admin();
  const id = context.params.id ? Number(context.params.id) : null;
  const action = context.params.action ?? null;

  // GET list
  if (req.method === "GET" && !id) {
    const status = new URL(req.url).searchParams.get("status");
    let q = sb.from("applications").select(SELECT).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    return error ? fail(error.message, 500) : json((data ?? []).map(serialize));
  }

  // GET signed CV url
  if (req.method === "GET" && id && action === "cv-url") {
    const { data: doc } = await sb
      .from("documents")
      .select("storage_path, filename")
      .eq("application_id", id)
      .eq("kind", "cv")
      .maybeSingle();
    if (!doc) return fail("CV introuvable", 404);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
    return error ? fail(error.message, 500) : json({ url: data.signedUrl, filename: doc.filename });
  }

  // PATCH status
  if (req.method === "PATCH" && id && action === "status") {
    const b = await readBody(req);
    const { data, error } = await sb
      .from("applications")
      .update({ status: b.status })
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();
    if (error) return fail(error.message, 500);
    return data ? json(serialize(data)) : fail("Candidature introuvable", 404);
  }

  // POST reanalyze
  if (req.method === "POST" && id && action === "reanalyze") {
    const origin = new URL(req.url).origin;
    fetch(`${origin}/.netlify/functions/analyze-application-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ application_id: id }),
    }).catch(() => {});
    return json({ id, status: "parsing" });
  }

  // DELETE
  if (req.method === "DELETE" && id) {
    const { data: docs } = await sb.from("documents").select("storage_path").eq("application_id", id);
    const paths = (docs ?? []).map((d) => d.storage_path);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    const { error } = await sb.from("applications").delete().eq("id", id);
    return error ? fail(error.message, 500) : noContent();
  }

  return fail("Méthode non autorisée", 405);
};
