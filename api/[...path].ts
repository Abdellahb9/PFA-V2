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

// Long-running CV analysis needs more than the 10s default.
export const config = { maxDuration: 60 };

export default async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  for (const r of routes) {
    const m = pathname.match(r.re);
    if (!m) continue;
    const params: Record<string, string> = {};
    (r.keys ?? []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return r.fn(req, { params });
  }
  return new Response(JSON.stringify({ detail: "Route introuvable" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}
