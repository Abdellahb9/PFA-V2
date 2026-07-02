// Vercel catch-all that reuses the existing Netlify v2 handlers unchanged.
// Each handler is `(req: Request, ctx: { params }) => Response`; here we parse
// the path params from the URL and dispatch, mirroring Netlify's `config.path`.
import type { IncomingMessage, ServerResponse } from "node:http";
import departments from "../netlify/functions/departments";
import offers from "../netlify/functions/offers";
import applications from "../netlify/functions/applications";
import candidates from "../netlify/functions/candidates";
import assignments from "../netlify/functions/assignments";
import users from "../netlify/functions/users";
import matchingRun from "../netlify/functions/matching-run";
import matchingRuns from "../netlify/functions/matching-runs";
import dashboard from "../netlify/functions/dashboard";
import publicOffers from "../netlify/functions/public-offers";
import submitApplication from "../netlify/functions/submit-application";
import myApplications from "../netlify/functions/my-applications";
import offerRankings from "../netlify/functions/offer-rankings";
import capacityForecast from "../netlify/functions/capacity-forecast";
import createUploadUrl from "../netlify/functions/create-upload-url";
import analyzeBackground from "../netlify/functions/analyze-application-background";
import assistant from "../netlify/functions/assistant";

// Handlers are the Netlify v2 defaults; they only read `ctx.params` at runtime,
// so `ctx` is loosely typed here to accept every handler signature.
type Handler = (req: Request, ctx: any) => Response | Promise<Response>;
interface Route {
  re: RegExp;
  fn: Handler;
  keys?: string[];
}

// Order matters: most specific patterns first.
const routes: Route[] = [
  { re: /^\/api\/assistant\/documents\/([^/]+)\/?$/, fn: assistant, keys: ["name"] },
  { re: /^\/api\/assistant\/(?:query|documents)\/?$/, fn: assistant },

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

  { re: /^\/api\/offer-rankings\/?$/, fn: offerRankings },
  { re: /^\/api\/capacity-forecast\/?$/, fn: capacityForecast },
  { re: /^\/api\/matching-runs\/?$/, fn: matchingRuns },
  { re: /^\/api\/matching-run\/?$/, fn: matchingRun },
  { re: /^\/api\/dashboard\/?$/, fn: dashboard },
  { re: /^\/api\/public-offers\/?$/, fn: publicOffers },
  { re: /^\/api\/submit-application\/?$/, fn: submitApplication },
  { re: /^\/api\/my-applications\/?$/, fn: myApplications },
  { re: /^\/api\/create-upload-url\/?$/, fn: createUploadUrl },
  { re: /^\/api\/analyze-application-background\/?$/, fn: analyzeBackground },
];

// Web-standard router (what the reused Netlify handlers expect). The Request
// here is already absolute and proper (built by nodeToRequest).
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
    if (buf.length) init.body = buf as unknown as BodyInit;
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
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ detail: e instanceof Error ? e.message : "Erreur serveur" }));
  }
}
