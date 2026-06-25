// Vercel catch-all that reuses the existing Netlify v2 handlers unchanged.
// Each handler is `(req: Request, ctx: { params }) => Response`; here we parse
// the path params from the URL and dispatch, mirroring Netlify's `config.path`.
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
import createUploadUrl from "../netlify/functions/create-upload-url";
import analyzeBackground from "../netlify/functions/analyze-application-background";

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
  { re: /^\/api\/matching-runs\/?$/, fn: matchingRuns },
  { re: /^\/api\/matching-run\/?$/, fn: matchingRun },
  { re: /^\/api\/dashboard\/?$/, fn: dashboard },
  { re: /^\/api\/public-offers\/?$/, fn: publicOffers },
  { re: /^\/api\/submit-application\/?$/, fn: submitApplication },
  { re: /^\/api\/my-applications\/?$/, fn: myApplications },
  { re: /^\/api\/create-upload-url\/?$/, fn: createUploadUrl },
  { re: /^\/api\/analyze-application-background\/?$/, fn: analyzeBackground },
];

// Vercel passes a RELATIVE req.url (just the path); the Web Request spec and the
// reused handlers expect an absolute URL. Rebuild one from the forwarded host.
function toAbsolute(req: Request): string {
  if (/^https?:\/\//i.test(req.url)) return req.url;
  const host = req.headers.get("host") ?? "localhost";
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0];
  const path = req.url.startsWith("/") ? req.url : `/${req.url}`;
  return `${proto}://${host}${path}`;
}

function withUrl(req: Request, url: string): Request {
  if (url === req.url) return req;
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: req.headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

export default async function handler(req: Request): Promise<Response> {
  const absUrl = toAbsolute(req);
  const { pathname } = new URL(absUrl);

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
      return await r.fn(withUrl(req, absUrl), { params });
    } catch (e) {
      // Surface the real error as JSON instead of a generic crash.
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
