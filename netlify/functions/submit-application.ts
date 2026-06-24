// POST /api/submit-application — public. Creates candidate + application + the
// CV document row (already uploaded via the signed URL), then fires the async
// analysis. Returns a minimal confirmation (no candidate data echoed).
import { z } from "zod";
import { admin, BUCKET } from "./_shared/supabase";
import { getOptionalUser } from "./_shared/auth";
import { json, fail } from "./_shared/http";

const schema = z.object({
  first_name: z.string().min(1).max(120),
  last_name: z.string().min(1).max(120),
  email: z.string().email().max(255),
  phone: z.string().max(40).optional(),
  field_of_study: z.string().max(180).optional(),
  education_level: z.string().max(120).optional(),
  university: z.string().max(200).optional(),
  motivation: z.string().max(4000).optional(),
  offer_id: z.number().int().positive().nullable().optional(),
  cv: z.object({
    path: z.string().min(1),
    filename: z.string().min(1),
    content_type: z.string().optional(),
    size: z.number().optional(),
  }),
});

export const config = { path: "/api/submit-application" };

function triggerAnalysis(applicationId: number, req: Request) {
  const origin = new URL(req.url).origin;
  const onVercel = Boolean(process.env.VERCEL);
  // Netlify uses background functions; Vercel routes everything through /api.
  const url = onVercel
    ? `${origin}/api/analyze-application-background`
    : `${origin}/.netlify/functions/analyze-application-background`;
  const promise = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ application_id: applicationId }),
  }).catch(() => {});
  // On Vercel, keep the invocation alive until the trigger is dispatched.
  // Variable specifier so esbuild doesn't try to bundle the dep on Netlify.
  if (onVercel) {
    const mod = "@vercel/functions";
    import(mod)
      .then((m: { waitUntil?: (p: Promise<unknown>) => void }) => m.waitUntil?.(promise))
      .catch(() => {});
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return fail("Méthode non autorisée", 405);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Données invalides", 422);
  const b = parsed.data;
  const sb = admin();

  // Validate that the uploaded object exists and is within size (server-side).
  const { data: meta } = await sb.storage
    .from(BUCKET)
    .list("cv", { search: b.cv.path.replace(/^cv\//, "") });
  const obj = (meta ?? []).find((m) => `cv/${m.name}` === b.cv.path);
  if (!obj) return fail("Fichier CV introuvable", 400);
  if ((obj.metadata?.size ?? 0) > 10 * 1024 * 1024) {
    return fail("Fichier trop volumineux (max 10 Mo)", 413);
  }

  // Link to the signed-in candidate account if a session is present (optional).
  const user = await getOptionalUser(req);

  // Reuse candidate by email, else create.
  let candidateId: number;
  const { data: existing } = await sb
    .from("candidates")
    .select("id, user_id")
    .eq("email", b.email)
    .maybeSingle();
  if (existing) {
    candidateId = existing.id;
    if (user && !existing.user_id) {
      await sb.from("candidates").update({ user_id: user.id }).eq("id", candidateId);
    }
  } else {
    const { data, error } = await sb
      .from("candidates")
      .insert({
        first_name: b.first_name,
        last_name: b.last_name,
        email: b.email,
        phone: b.phone ?? null,
        field_of_study: b.field_of_study ?? null,
        education_level: b.education_level ?? null,
        university: b.university ?? null,
        user_id: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) return fail(error.message, 500);
    candidateId = data.id;
  }

  const { data: app, error: appErr } = await sb
    .from("applications")
    .insert({
      candidate_id: candidateId,
      offer_id: b.offer_id ?? null,
      motivation: b.motivation ?? null,
      status: "submitted",
    })
    .select("id, status")
    .single();
  if (appErr) return fail(appErr.message, 500);

  await sb.from("documents").insert({
    application_id: app.id,
    kind: "cv",
    filename: b.cv.filename,
    storage_path: b.cv.path,
    content_type: b.cv.content_type ?? null,
    size: b.cv.size ?? 0,
  });

  triggerAnalysis(app.id, req);
  return json({ id: app.id, status: app.status, message: "Candidature reçue." }, 201);
};
