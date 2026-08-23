// POST /api/create-switch-proof-upload-url — URL signée pour téléverser la
// preuve d'accord (image) directement vers le stockage, comme pour les CV.
//
// Même bucket que les CV (`documents`), mais un endpoint distinct : celui des CV
// n'accepte que PDF/DOCX et impose le préfixe `cv/`. Le chemin reste imposé par
// le serveur — le navigateur ne choisit jamais où il écrit.
import { randomUUID } from "node:crypto";
import { admin, BUCKET } from "./_shared/supabase";
import { requireUser } from "./_shared/auth";
import { json, fail } from "./_shared/http";

export const config = { path: "/api/create-switch-proof-upload-url" };

const ALLOWED = /\.(jpe?g|png|webp)$/;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return fail("Méthode non autorisée", 405);
  // Contrairement au dépôt de candidature (public), un échange suppose un compte.
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const body = (await req.json().catch(() => ({}))) as { filename?: string };
  const filename = (body.filename ?? "preuve.jpg").toLowerCase();
  if (!ALLOWED.test(filename)) {
    return fail("Format non supporté : JPG, PNG ou WEBP uniquement", 415);
  }

  const safe = filename.replace(/[^\w.-]/g, "_");
  const path = `switch-proofs/${randomUUID()}-${safe}`;

  const { data, error } = await admin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return fail(error.message, 500);
  return json({ path, token: data.token });
};
