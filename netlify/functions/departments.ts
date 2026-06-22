// /api/departments  ·  /api/departments/:id   (admin CRUD)
import type { Context } from "@netlify/functions";
import { admin } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail, noContent, readBody } from "./_shared/http";

export const config = { path: ["/api/departments", "/api/departments/:id"] };

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  const id = context.params.id ? Number(context.params.id) : null;
  const sb = admin();

  if (req.method === "GET" && !id) {
    const { data, error } = await sb.from("departments").select("*").order("name");
    return error ? fail(error.message, 500) : json(data);
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    const { data: clash } = await sb.from("departments").select("id").eq("code", b.code).maybeSingle();
    if (clash) return fail("Code de département déjà existant", 409);
    const { data, error } = await sb
      .from("departments")
      .insert({
        name: b.name,
        code: b.code,
        description: b.description ?? null,
        supervisor_name: b.supervisor_name ?? null,
        supervisor_email: b.supervisor_email ?? null,
        capacity: b.capacity ?? 0,
      })
      .select()
      .single();
    return error ? fail(error.message, 500) : json(data, 201);
  }

  if (req.method === "PATCH" && id) {
    const b = await readBody(req);
    if (b.code) {
      const { data: clash } = await sb
        .from("departments")
        .select("id")
        .eq("code", b.code)
        .neq("id", id)
        .maybeSingle();
      if (clash) return fail("Code de département déjà existant", 409);
    }
    const { data, error } = await sb.from("departments").update(b).eq("id", id).select().maybeSingle();
    if (error) return fail(error.message, 500);
    return data ? json(data) : fail("Département introuvable", 404);
  }

  if (req.method === "DELETE" && id) {
    const { count } = await sb
      .from("internship_offers")
      .select("id", { count: "exact", head: true })
      .eq("department_id", id);
    if ((count ?? 0) > 0) {
      return fail(`Impossible de supprimer : ${count} offre(s) rattachée(s). Supprimez-les d'abord.`, 409);
    }
    const { error } = await sb.from("departments").delete().eq("id", id);
    return error ? fail(error.message, 500) : noContent();
  }

  return fail("Méthode non autorisée", 405);
};
