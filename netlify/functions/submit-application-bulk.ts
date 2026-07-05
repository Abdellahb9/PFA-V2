// POST /api/submit-application-bulk — staff only. Creates one application per
// CV already uploaded via signed URLs, with a placeholder candidate identity
// derived from the filename. The background analysis then fills the real
// identity (name/email) extracted from the CV text.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { admin, BUCKET } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail } from "./_shared/http";
import { triggerAnalysis } from "./_shared/trigger-analysis";

// Placeholder emails carry this domain so the analyzer knows the identity is
// provisional and must be replaced by what the CV contains.
export const PLACEHOLDER_EMAIL_DOMAIN = "cv-import.local";

const MAX_FILES = 20;

const schema = z.object({
  offer_id: z.number().int().positive().nullable().optional(),
  cvs: z
    .array(
      z.object({
        path: z.string().min(1),
        filename: z.string().min(1),
        content_type: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .min(1)
    .max(MAX_FILES),
});

export const config = { path: "/api/submit-application-bulk" };

// "jean_dupont_CV.pdf" -> { first: "Jean", last: "Dupont" }
function guessNameFromFilename(filename: string): { first: string; last: string } {
  const base = filename.replace(/\.(pdf|docx)$/i, "");
  const words = base
    .split(/[_\-.\s]+/)
    .filter((w) => w && !/^(cv|resume|curriculum|vitae|\d+)$/i.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return {
    first: words[0] ?? "Candidat",
    last: words.slice(1).join(" ") || "(import CV)",
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return fail("Méthode non autorisée", 405);
  const user = await requireStaff(req);
  if (user instanceof Response) return user;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Données invalides", 422);
  const b = parsed.data;
  const sb = admin();

  const created: { application_id: number; filename: string }[] = [];
  const errors: { filename: string; detail: string }[] = [];

  for (const cv of b.cvs) {
    // Validate the uploaded object exists and is within size (server-side).
    const { data: meta } = await sb.storage
      .from(BUCKET)
      .list("cv", { search: cv.path.replace(/^cv\//, "") });
    const obj = (meta ?? []).find((m) => `cv/${m.name}` === cv.path);
    if (!obj) {
      errors.push({ filename: cv.filename, detail: "Fichier CV introuvable" });
      continue;
    }
    if ((obj.metadata?.size ?? 0) > 10 * 1024 * 1024) {
      errors.push({ filename: cv.filename, detail: "Fichier trop volumineux (max 10 Mo)" });
      continue;
    }

    const name = guessNameFromFilename(cv.filename);
    const { data: cand, error: candErr } = await sb
      .from("candidates")
      .insert({
        first_name: name.first,
        last_name: name.last,
        email: `import-${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`,
      })
      .select("id")
      .single();
    if (candErr) {
      errors.push({ filename: cv.filename, detail: candErr.message });
      continue;
    }

    const { data: app, error: appErr } = await sb
      .from("applications")
      .insert({
        candidate_id: cand.id,
        offer_id: b.offer_id ?? null,
        status: "submitted",
      })
      .select("id")
      .single();
    if (appErr) {
      await sb.from("candidates").delete().eq("id", cand.id);
      errors.push({ filename: cv.filename, detail: appErr.message });
      continue;
    }

    await sb.from("documents").insert({
      application_id: app.id,
      kind: "cv",
      filename: cv.filename,
      storage_path: cv.path,
      content_type: cv.content_type ?? null,
      size: cv.size ?? 0,
    });

    triggerAnalysis(app.id, req);
    created.push({ application_id: app.id, filename: cv.filename });
  }

  if (!created.length) {
    return fail(errors[0]?.detail ?? "Aucune candidature créée", 400);
  }
  return json({ created, errors }, 201);
};
