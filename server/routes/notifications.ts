// GET  /api/notifications          — les notifications du compte appelant
// POST /api/notifications/:id/read — marquer comme lue
//
// Chaque requête est filtrée sur user_id : la clé service role contourne RLS,
// c'est donc ici que l'isolement entre comptes est garanti.
import { admin } from "../lib/supabase";
import { requireUser } from "../lib/auth";
import { json, fail } from "../lib/http";
import type { RouteContext } from "../lib/http";

const LIMIT = 30;

export default async (req: Request, context: RouteContext): Promise<Response> => {
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
