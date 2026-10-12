// POST /api/submit-application-bulk — staff only. Creates one application per
// CV already uploaded via signed URLs, with a placeholder candidate identity
// derived from the filename. The background analysis then fills the real
// identity (name/email) extracted from the CV text.
import { z } from "zod";
import { admin, BUCKET } from "../lib/supabase";
import { requireStaff } from "../lib/auth";
import { json, fail } from "../lib/http";
import { createCvApplication } from "../lib/cv-pipeline";
import { triggerAnalysis } from "../lib/trigger-analysis";

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

    let app: { applicationId: number };
    try {
      app = await createCvApplication({
        filename: cv.filename,
        storagePath: cv.path,
        contentType: cv.content_type ?? null,
        size: cv.size ?? 0,
        offerId: b.offer_id ?? null,
      });
    } catch (err) {
      errors.push({ filename: cv.filename, detail: err instanceof Error ? err.message : String(err) });
      continue;
    }

    triggerAnalysis(app.applicationId, req);
    created.push({ application_id: app.applicationId, filename: cv.filename });
  }

  if (!created.length) {
    return fail(errors[0]?.detail ?? "Aucune candidature créée", 400);
  }
  return json({ created, errors }, 201);
};
