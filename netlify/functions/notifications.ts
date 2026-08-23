// GET  /api/notifications          — les notifications du compte appelant
// POST /api/notifications/:id/read — marquer comme lue
//
// Chaque requête est filtrée sur user_id : la clé service role contourne RLS,
// c'est donc ici que l'isolement entre comptes est garanti.
import type { Context } from "@netlify/functions";
import { admin } from "./_shared/supabase";
import { requireUser } from "./_shared/auth";
import { json, fail } from "./_shared/http";

export const config = { path: ["/api/notifications", "/api/notifications/:id/read"] };

const LIMIT = 30;

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const sb = admin();
  const id = context.params?.id;

  if (req.method === "GET" && !id) {
    const { data, error } = await sb
      .from("notifications")
      .select("id, type, title, body, read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    return error ? fail(error.message, 500) : json(data ?? []);
  }

  if (req.method === "POST" && id) {
    // Le filtre sur user_id empêche de marquer lue la notification d'autrui.
    const { data, error } = await sb
      .from("notifications")
      .update({ read: true })
      .eq("id", Number(id))
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message, 500);
    return data ? json({ id: data.id, read: true }) : fail("Notification introuvable", 404);
  }

  return fail("Méthode non autorisée", 405);
};
