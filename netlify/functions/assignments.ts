// /api/assignments  ·  /api/assignments/:id   (admin: list + confirm/reject)
import type { Context } from "@netlify/functions";
import { admin } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail, readBody } from "./_shared/http";

export const config = { path: ["/api/assignments", "/api/assignments/:id"] };

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  const sb = admin();
  const id = context.params.id ? Number(context.params.id) : null;

  if (req.method === "GET" && !id) {
    const status = new URL(req.url).searchParams.get("status");
    let q = sb.from("assignments").select("*").order("match_score", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    return error ? fail(error.message, 500) : json(data);
  }

  if (req.method === "PATCH" && id) {
    const url = new URL(req.url);
    const body = await readBody(req);
    const status = (body.status ?? url.searchParams.get("status")) as string;
    if (!["confirmed", "rejected", "proposed"].includes(status)) return fail("Statut invalide", 422);

    const { data: a, error } = await sb
      .from("assignments")
      .update({ status, decided_by: user.email })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!a) return fail("Affectation introuvable", 404);

    if (status === "confirmed") {
      await sb.from("applications").update({ status: "assigned" }).eq("id", a.application_id);
    } else if (status === "rejected") {
      await sb.from("applications").update({ status: "under_review" }).eq("id", a.application_id);
    }
    return json(a);
  }

  return fail("Méthode non autorisée", 405);
};
