// Fire-and-forget trigger of the CV-analysis background function, portable
// across hosts: Netlify exposes it at /.netlify/functions/*, Vercel routes it
// through /api/* (and needs waitUntil to keep the invocation alive until the
// trigger request is actually dispatched).
export function triggerAnalysis(applicationId: number, req: Request): void {
  const origin = new URL(req.url).origin;
  const onVercel = Boolean(process.env.VERCEL);
  const url = onVercel
    ? `${origin}/api/analyze-application-background`
    : `${origin}/.netlify/functions/analyze-application-background`;
  const promise = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ application_id: applicationId }),
  }).catch(() => {});
  // Variable specifier so esbuild doesn't try to bundle the dep on Netlify.
  if (onVercel) {
    const mod = "@vercel/functions";
    import(mod)
      .then((m: { waitUntil?: (p: Promise<unknown>) => void }) => m.waitUntil?.(promise))
      .catch(() => {});
  }
}
