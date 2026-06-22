// Verify a Supabase Auth access token (Bearer) and enforce staff access.
import { admin } from "./supabase";
import { fail } from "./http";

export interface AuthedUser {
  id: string;
  email: string | null;
  role: "admin" | "recruiter" | "viewer";
}

/**
 * Returns the authenticated staff user, or a Response (401/403) to return as-is.
 * Usage: `const u = await requireStaff(req); if (u instanceof Response) return u;`
 */
export async function requireStaff(req: Request): Promise<AuthedUser | Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return fail("Non authentifié", 401);

  const sb = admin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return fail("Session invalide", 401);

  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  const role = (profile?.role ?? "recruiter") as AuthedUser["role"];
  if (role !== "admin" && role !== "recruiter") {
    return fail("Accès refusé", 403);
  }
  return { id: data.user.id, email: data.user.email ?? null, role };
}
