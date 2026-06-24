// /api/candidates  ·  /api/candidates/:id   (admin: read + internal notes)
import type { Context } from "@netlify/functions";
import { admin } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail, readBody } from "./_shared/http";

export const config = { path: ["/api/candidates", "/api/candidates/:id"] };

const SELECT =
  "id, first_name, last_name, email, phone, education_level, field_of_study, university, years_experience, cv_text, candidate_skills(weight, skill:skills(name))";
// Detail/notes variant — requires migration 0004 (candidates.notes).
const SELECT_DETAIL =
  "id, first_name, last_name, email, phone, education_level, field_of_study, university, years_experience, notes, cv_text, candidate_skills(weight, skill:skills(name))";

function serialize(c: any) {
  const skills = (c.candidate_skills ?? [])
    .map((cs: any) => ({ name: cs.skill?.name, weight: cs.weight }))
    .filter((s: any) => s.name);
  return {
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    full_name: `${c.first_name} ${c.last_name}`.trim(),
    email: c.email,
    phone: c.phone,
    education_level: c.education_level,
    field_of_study: c.field_of_study,
    university: c.university,
    years_experience: c.years_experience,
    notes: c.notes ?? null,
    skills,
    has_embedding: Boolean(c.cv_text), // "analysé" — pas d'embeddings en serverless
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  const sb = admin();
  const id = context.params.id ? Number(context.params.id) : null;

  // Update internal admin notes on a candidate.
  if (req.method === "PATCH" && id) {
    const b = await readBody(req);
    const { data, error } = await sb
      .from("candidates")
      .update({ notes: b.notes ?? null })
      .eq("id", id)
      .select(SELECT_DETAIL)
      .maybeSingle();
    if (error) return fail(error.message, 500);
    return data ? json(serialize(data)) : fail("Candidat introuvable", 404);
  }

  if (req.method !== "GET") return fail("Méthode non autorisée", 405);

  if (id) {
    const { data, error } = await sb
      .from("candidates")
      .select(SELECT_DETAIL)
      .eq("id", id)
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!data) return fail("Candidat introuvable", 404);
    // Include the candidate's applications (the CRM "relationship" timeline).
    const { data: apps } = await sb
      .from("applications")
      .select("id, status, match_score, created_at, offer:offers(title)")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false });
    const applications = (apps ?? []).map((a: any) => ({
      id: a.id,
      status: a.status,
      match_score: a.match_score,
      created_at: a.created_at,
      offer_title: a.offer?.title ?? null,
    }));
    return json({ ...serialize(data), applications });
  }

  const search = new URL(req.url).searchParams.get("search");
  let query = sb.from("candidates").select(SELECT).order("created_at", { ascending: false });
  if (search) {
    query = query.or(
      `last_name.ilike.%${search}%,first_name.ilike.%${search}%,field_of_study.ilike.%${search}%`,
    );
  }
  const { data, error } = await query;
  return error ? fail(error.message, 500) : json((data ?? []).map(serialize));
};
