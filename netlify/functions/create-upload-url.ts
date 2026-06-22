// POST /api/create-upload-url — returns a signed URL so the browser uploads the
// CV directly to Supabase Storage (private bucket), bypassing the function body
// size limit. Public, but only allows uploads to a server-generated path.
import { randomUUID } from "node:crypto";
import { admin, BUCKET } from "./_shared/supabase";
import { json, fail } from "./_shared/http";

export const config = { path: "/api/create-upload-url" };

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return fail("Méthode non autorisée", 405);
  const body = (await req.json().catch(() => ({}))) as { filename?: string };
  const filename = (body.filename ?? "cv.pdf").toLowerCase();
  if (!/\.(pdf|docx)$/.test(filename)) {
    return fail("Format non supporté : PDF ou DOCX uniquement", 415);
  }
  const safe = filename.replace(/[^\w.-]/g, "_");
  const path = `cv/${randomUUID()}-${safe}`;

  const { data, error } = await admin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return fail(error.message, 500);
  return json({ path, token: data.token });
};
