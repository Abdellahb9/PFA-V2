// Supabase Auth helpers: verify a Bearer token, resolve role, gate access.
import { admin } from "./supabase";
import { fail } from "./http";

export type Role = "admin" | "recruiter" | "viewer" | "candidate";

export interface AuthedUser {
  id: string;
  email: string | null;
  role: Role;
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function resolve(token: string): Promise<AuthedUser | null> {
  if (!token) return null;
  const sb = admin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  let { data: profile, error: pErr } = await sb
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  // `is_active` may not exist yet (migration 0004 not applied) — fall back so
  // nobody gets locked out before the migration runs.
  if (pErr) {
    ({ data: profile } = await sb
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle());
  }
  // A deactivated account has no access.
  if (profile && (profile as { is_active?: boolean }).is_active === false) return null;
  // Safe default: unknown -> candidate (never staff).
  const role = (profile?.role ?? "candidate") as Role;
  return { id: data.user.id, email: data.user.email ?? null, role };
}

/** Any authenticated user (candidate or staff), or a 401 Response. */
export async function requireUser(req: Request): Promise<AuthedUser | Response> {
  const user = await resolve(bearer(req));
  return user ?? fail("Non authentifié", 401);
}

/** Staff only (admin / recruiter), or a 401/403 Response. */
export async function requireStaff(req: Request): Promise<AuthedUser | Response> {
  const token = bearer(req);
  if (!token) return fail("Non authentifié", 401);
  const user = await resolve(token);
  if (!user) return fail("Session invalide", 401);
  if (user.role !== "admin" && user.role !== "recruiter") {
    return fail("Accès refusé", 403);
  }
  return user;
}

/** Admin only, or a 401/403 Response. */
export async function requireAdmin(req: Request): Promise<AuthedUser | Response> {
  const token = bearer(req);
  if (!token) return fail("Non authentifié", 401);
  const user = await resolve(token);
  if (!user) return fail("Session invalide", 401);
  if (user.role !== "admin") return fail("Accès réservé à l'administrateur", 403);
  return user;
}

/** The user if a valid token is present, else null (no error). */
export async function getOptionalUser(req: Request): Promise<AuthedUser | null> {
  return resolve(bearer(req));
}
