// GET /api/public-offers — open offers for the landing page (no auth).
import { admin } from "./_shared/supabase";
import { json, fail } from "./_shared/http";

export const config = { path: "/api/public-offers" };

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);
  const sb = admin();
  const { data, error } = await sb
    .from("internship_offers")
    .select(
      "id, title, field, slots, description, department:departments(name), offer_skills(weight, skill:skills(name))",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) return fail(error.message, 500);

  const offers = (data ?? []).map((o: any) => ({
    id: o.id,
    title: o.title,
    field: o.field,
    slots: o.slots,
    description: o.description,
    department_name: o.department?.name ?? null,
    skills: (o.offer_skills ?? [])
      .map((os: any) => ({ name: os.skill?.name, weight: os.weight }))
      .filter((s: any) => s.name),
  }));
  return json(offers);
};
