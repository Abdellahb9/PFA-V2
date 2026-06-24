// /api/users  ·  /api/users/:id   (admin only): account & role management.
import type { Context } from "@netlify/functions";
import { admin } from "./_shared/supabase";
import { requireAdmin } from "./_shared/auth";
import { json, fail, readBody } from "./_shared/http";

export const config = { path: ["/api/users", "/api/users/:id"] };

const ROLES = ["admin", "recruiter", "viewer", "candidate"];
// ~100 years — Supabase Auth ban to block sign-in for a deactivated account.
const BAN_FOREVER = "876600h";

export default async (req: Request, context: Context): Promise<Response> => {
  const me = await requireAdmin(req);
  if (me instanceof Response) return me;
  const sb = admin();
  const id = context.params.id ?? null;

  // --- List all accounts (auth + profile + application counts) ---
  if (req.method === "GET" && !id) {
    const { data: list, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return fail(error.message, 500);

    const [{ data: profiles }, { data: candidates }, { data: apps }] = await Promise.all([
      sb.from("profiles").select("id, role, full_name, is_active"),
      sb.from("candidates").select("id, user_id"),
      sb.from("applications").select("candidate_id"),
    ]);

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    // Map user_id -> candidate ids, then count applications per user.
    const candByUser = new Map<string, number[]>();
    for (const c of candidates ?? []) {
      if (!c.user_id) continue;
      const arr = candByUser.get(c.user_id) ?? [];
      arr.push(c.id);
      candByUser.set(c.user_id, arr);
    }
    const appCountByCand = new Map<number, number>();
    for (const a of apps ?? []) {
      appCountByCand.set(a.candidate_id, (appCountByCand.get(a.candidate_id) ?? 0) + 1);
    }

    const users = list.users.map((u) => {
      const p = profileById.get(u.id);
      const candIds = candByUser.get(u.id) ?? [];
      const applicationCount = candIds.reduce((s, cid) => s + (appCountByCand.get(cid) ?? 0), 0);
      return {
        id: u.id,
        email: u.email ?? null,
        full_name: (p?.full_name as string | undefined) ?? (u.user_metadata?.full_name ?? null),
        role: (p?.role as string | undefined) ?? "candidate",
        is_active: (p?.is_active as boolean | undefined) ?? true,
        email_confirmed: Boolean(u.email_confirmed_at),
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        candidate_id: candIds[0] ?? null,
        application_count: applicationCount,
      };
    });
    // Most recently active first.
    users.sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""));
    return json(users);
  }

  // --- Create a staff account ---
  if (req.method === "POST" && !id) {
    const b = await readBody(req);
    const email = String(b.email ?? "").trim();
    const password = String(b.password ?? "");
    const fullName = String(b.full_name ?? "").trim();
    const role = String(b.role ?? "recruiter");
    if (!email || password.length < 6) return fail("Email et mot de passe (6+) requis", 422);
    if (!ROLES.includes(role)) return fail("Rôle invalide", 422);

    const { data: created, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // staff accounts are pre-confirmed
      user_metadata: { full_name: fullName },
    });
    if (error || !created.user) return fail(error?.message ?? "Création impossible", 400);

    // handle_new_user() created a profile (role candidate) — set the chosen role.
    await sb
      .from("profiles")
      .update({ role, full_name: fullName || email, is_active: true })
      .eq("id", created.user.id);
    return json({ id: created.user.id, email, full_name: fullName, role }, 201);
  }

  // --- Update role / activation ---
  if (req.method === "PATCH" && id) {
    const b = await readBody(req);
    if (id === me.id && (b.role !== undefined || b.is_active === false)) {
      return fail("Vous ne pouvez pas modifier votre propre rôle ou accès.", 400);
    }
    const patch: Record<string, unknown> = {};
    if (b.role !== undefined) {
      if (!ROLES.includes(String(b.role))) return fail("Rôle invalide", 422);
      patch.role = b.role;
    }
    if (b.is_active !== undefined) patch.is_active = Boolean(b.is_active);
    if (Object.keys(patch).length === 0) return fail("Rien à mettre à jour", 422);

    const { error } = await sb.from("profiles").update(patch).eq("id", id);
    if (error) return fail(error.message, 500);

    // Block / restore sign-in at the Auth level when activation changes.
    if (b.is_active !== undefined) {
      await sb.auth.admin.updateUserById(id, {
        ban_duration: b.is_active ? "none" : BAN_FOREVER,
      });
    }
    return json({ id, ...patch });
  }

  return fail("Méthode non autorisée", 405);
};
