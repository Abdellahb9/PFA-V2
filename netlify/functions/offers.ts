// /api/offers  ·  /api/offers/:id   (admin CRUD + required skills)
import type { Context } from "@netlify/functions";
import { admin } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { getOrCreateSkill } from "./_shared/db";
import { json, fail, noContent, readBody } from "./_shared/http";

export const config = { path: ["/api/offers", "/api/offers/:id"] };

const SELECT =
  "id, department_id, title, description, field, slots, min_education_level, status, created_at, offer_skills(weight, skill:skills(name))";

function serialize(o: any) {
  return {
    id: o.id,
    department_id: o.department_id,
    title: o.title,
    description: o.description,
    field: o.field,
    slots: o.slots,
    min_education_level: o.min_education_level,
    status: o.status,
    skills: (o.offer_skills ?? [])
      .map((os: any) => ({ name: os.skill?.name, weight: os.weight }))
      .filter((s: any) => s.name),
  };
}

async function applySkills(offerId: number, skills: { name: string; weight?: number }[]) {
  const sb = admin();
  await sb.from("offer_skills").delete().eq("offer_id", offerId);
  for (const ref of skills ?? []) {
    const skillId = await getOrCreateSkill(ref.name);
    await sb
      .from("offer_skills")
      .upsert(
        { offer_id: offerId, skill_id: skillId, weight: ref.weight ?? 1.0 },
        { onConflict: "offer_id,skill_id" },
      );
  }
}

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  const id = context.params.id ? Number(context.params.id) : null;
  const sb = admin();

  if (req.method === "GET" && !id) {
    const { data, error } = await sb.from("internship_offers").select(SELECT).order("created_at", { ascending: false });
    return error ? fail(error.message, 500) : json((data ?? []).map(serialize));
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    const { data, error } = await sb
      .from("internship_offers")
      .insert({
        department_id: b.department_id,
        title: b.title,
        description: b.description ?? null,
        field: b.field ?? null,
        slots: b.slots ?? 1,
        min_education_level: b.min_education_level ?? null,
        status: b.status ?? "open",
      })
      .select("id")
      .single();
    if (error) return fail(error.message, 500);
    await applySkills(data.id, b.skills ?? []);
    const { data: full } = await sb.from("internship_offers").select(SELECT).eq("id", data.id).single();
    return json(serialize(full), 201);
  }

  if (req.method === "PATCH" && id) {
    const b = await readBody(req);
    const { skills, ...fields } = b;
    if (Object.keys(fields).length) await sb.from("internship_offers").update(fields).eq("id", id);
    if (Array.isArray(skills)) await applySkills(id, skills);
    const { data: full } = await sb.from("internship_offers").select(SELECT).eq("id", id).maybeSingle();
    return full ? json(serialize(full)) : fail("Offre introuvable", 404);
  }

  if (req.method === "DELETE" && id) {
    const { count } = await sb
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("offer_id", id);
    if ((count ?? 0) > 0) {
      return fail(`Impossible de supprimer : ${count} candidature(s) liée(s) à cette offre.`, 409);
    }
    const { error } = await sb.from("internship_offers").delete().eq("id", id);
    return error ? fail(error.message, 500) : noContent();
  }

  return fail("Méthode non autorisée", 405);
};
