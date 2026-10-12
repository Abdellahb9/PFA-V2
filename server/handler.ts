// Routeur unique de l'API Vercel (api/[...path].ts → bundle api/_handler.cjs).
// Chaque route est `(req: Request, ctx: { params }) => Response` (Web standard) ;
// on extrait ici les paramètres du chemin puis on délègue.
import type { IncomingMessage, ServerResponse } from "node:http";
import departments from "./routes/departments";
import offers from "./routes/offers";
import applications from "./routes/applications";
import candidates from "./routes/candidates";
import assignments from "./routes/assignments";
import users from "./routes/users";
import matchingRun from "./routes/matching-run";
import matchingRuns from "./routes/matching-runs";
import dashboard from "./routes/dashboard";
import publicOffers from "./routes/public-offers";
import submitApplication from "./routes/submit-application";
import submitApplicationBulk from "./routes/submit-application-bulk";
import myApplications from "./routes/my-applications";
import offerRankings from "./routes/offer-rankings";
import capacityForecast from "./routes/capacity-forecast";
import createUploadUrl from "./routes/create-upload-url";
import analyzeCv from "./routes/analyze-cv";
import ragEmbed from "./routes/rag-embed";
import assistant from "./routes/assistant";
import bookings from "./routes/bookings";
import offerSwitchRequests from "./routes/offer-switch-requests";
import mySwitchRequests from "./routes/my-switch-requests";
import notifications from "./routes/notifications";
import createSwitchProofUploadUrl from "./routes/create-switch-proof-upload-url";

// Les routes ne lisent que `ctx.params` : `ctx` reste peu typé ici pour accepter
// toutes les signatures.
type Handler = (req: Request, ctx: any) => Response | Promise<Response>;
interface Route {
  re: RegExp;
  fn: Handler;
  keys?: string[];
}

// Order matters: most specific patterns first.
const routes: Route[] = [
  { re: /^\/api\/assistant\/conversations\/([^/]+)\/?$/, fn: assistant, keys: ["id"] },
  { re: /^\/api\/assistant\/documents\/([^/]+)\/?$/, fn: assistant, keys: ["name"] },
  { re: /^\/api\/assistant\/(?:chat|documents|conversations|reindex)\/?$/, fn: assistant },

  { re: /^\/api\/applications\/([^/]+)\/([^/]+)\/?$/, fn: applications, keys: ["id", "action"] },
  { re: /^\/api\/applications\/([^/]+)\/?$/, fn: applications, keys: ["id"] },
  { re: /^\/api\/applications\/?$/, fn: applications },

  { re: /^\/api\/departments\/([^/]+)\/?$/, fn: departments, keys: ["id"] },
  { re: /^\/api\/departments\/?$/, fn: departments },

  { re: /^\/api\/offers\/([^/]+)\/?$/, fn: offers, keys: ["id"] },
  { re: /^\/api\/offers\/?$/, fn: offers },

  { re: /^\/api\/candidates\/([^/]+)\/?$/, fn: candidates, keys: ["id"] },
  { re: /^\/api\/candidates\/?$/, fn: candidates },

  { re: /^\/api\/assignments\/([^/]+)\/?$/, fn: assignments, keys: ["id"] },
  { re: /^\/api\/assignments\/?$/, fn: assignments },

  { re: /^\/api\/users\/([^/]+)\/?$/, fn: users, keys: ["id"] },
  { re: /^\/api\/users\/?$/, fn: users },

  { re: /^\/api\/offer-switch-requests\/([^/]+)\/([^/]+)\/?$/, fn: offerSwitchRequests, keys: ["id", "action"] },
  { re: /^\/api\/offer-switch-requests\/?$/, fn: offerSwitchRequests },
  { re: /^\/api\/my-switch-requests\/?$/, fn: mySwitchRequests },
  { re: /^\/api\/notifications\/([^/]+)\/read\/?$/, fn: notifications, keys: ["id"] },
  { re: /^\/api\/notifications\/?$/, fn: notifications },
  { re: /^\/api\/create-switch-proof-upload-url\/?$/, fn: createSwitchProofUploadUrl },

  { re: /^\/api\/bookings\/?$/, fn: bookings },
  { re: /^\/api\/offer-rankings\/?$/, fn: offerRankings },
  { re: /^\/api\/capacity-forecast\/?$/, fn: capacityForecast },
  { re: /^\/api\/matching-runs\/?$/, fn: matchingRuns },
  { re: /^\/api\/matching-run\/?$/, fn: matchingRun },
  { re: /^\/api\/dashboard\/?$/, fn: dashboard },
  { re: /^\/api\/public-offers\/?$/, fn: publicOffers },
  { re: /^\/api\/submit-application-bulk\/?$/, fn: submitApplicationBulk },
  { re: /^\/api\/submit-application\/?$/, fn: submitApplication },
  { re: /^\/api\/my-applications\/?$/, fn: myApplications },
  { re: /^\/api\/create-upload-url\/?$/, fn: createUploadUrl },
  { re: /^\/api\/analyze-cv\/?$/, fn: analyzeCv },
  { re: /^\/api\/rag-embed\/?$/, fn: ragEmbed },
];

// Routeur Web standard (ce qu'attendent les routes). La Request est déjà
// absolue et complète (construite par nodeToRequest).
export async function webHandler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  // Diagnostic endpoint — does NOT touch Supabase, so it succeeds even if env
  // vars are missing. Reveals whether the function can see its configuration.
  if (pathname === "/api/health") {
    return new Response(
      JSON.stringify({
        ok: true,
        node: process.version,
        hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
        hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        hasGroqKey: Boolean(process.env.GROQ_API_KEY),
        hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  for (const r of routes) {
    const m = pathname.match(r.re);
    if (!m) continue;
    const params: Record<string, string> = {};
    (r.keys ?? []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      return await r.fn(request, { params });
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Erreur serveur";
      return new Response(JSON.stringify({ detail }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return new Response(JSON.stringify({ detail: "Route introuvable" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length"]);

// Build a proper Web Request from Vercel's Node-style request.
async function nodeToRequest(req: IncomingMessage): Promise<Request> {
  const host = (req.headers.host as string | undefined) ?? "localhost";
  const xf = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(xf) ? xf[0] : xf ?? "https").split(",")[0];
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const method = (req.method ?? "GET").toUpperCase();

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null || HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, String(v));
  }

  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const buf = Buffer.concat(chunks);
    // Node Buffer is a valid runtime body; cast around the DOM lib typing.
    if (buf.length) init.body = buf as unknown as RequestInit["body"];
  }
  return new Request(url, init);
}

// Vercel (CommonJS) invokes functions with the Node (req, res) signature — bridge
// it to the Web handler and write the Web Response back to res.
export default async function nodeHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const response = await webHandler(await nodeToRequest(req));
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // Écrire les en-têtes AVANT de pomper le corps : sans cela le premier
    // événement SSE ne part qu'à la fin, et le flux perd tout son intérêt.
    res.writeHead(response.status);

    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        // Node bufferise par défaut ; flush() existe quand la compression est
        // active et doit être appelé pour que le client reçoive tout de suite.
        (res as ServerResponse & { flush?: () => void }).flush?.();
      }
    }
    res.end();
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ detail: e instanceof Error ? e.message : "Erreur serveur" }));
  }
}
