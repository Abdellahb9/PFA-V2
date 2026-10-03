// Fire-and-forget trigger of a background function, portable across hosts:
// Netlify exposes it at /.netlify/functions/*, Vercel routes it through /api/*
// (and needs waitUntil to keep the invocation alive until the trigger request
// is actually dispatched).
export function triggerBackground(fn: string, body: unknown, req: Request): void {
  const origin = new URL(req.url).origin;
  const onVercel = Boolean(process.env.VERCEL);
  const url = onVercel ? `${origin}/api/${fn}` : `${origin}/.netlify/functions/${fn}`;
  const promise = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
  // Variable specifier so esbuild doesn't try to bundle the dep on Netlify.
  if (onVercel) {
    const mod = "@vercel/functions";
    import(mod)
      .then((m: { waitUntil?: (p: Promise<unknown>) => void }) => m.waitUntil?.(promise))
      .catch(() => {});
  }
}

/** CV analysis of one application (analyze-application-background). */
export function triggerAnalysis(applicationId: number, req: Request): void {
  triggerBackground("analyze-application-background", { application_id: applicationId }, req);
}

/** Vectorisation des extraits documentaires en attente (rag-embed-background). */
export function triggerEmbedding(req: Request): void {
  triggerBackground("rag-embed-background", {}, req);
}
