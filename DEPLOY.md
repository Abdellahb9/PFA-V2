# Deployment

Serverless app: **React (Vite) frontend** + **serverless functions** + **Supabase**
(Postgres + Storage + Auth) + **Groq** (LLM extraction). Deployable on **Netlify**
(primary) or **Vercel**.

## Environment variables (both hosts)

| Variable | Scope | Value / source |
|---|---|---|
| `SUPABASE_URL` | server | `https://ucsnnpwqgckpzzufgczq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | server (secret) | Supabase → Settings → API → `service_role` |
| `GROQ_API_KEY` | server | console.groq.com → API Keys |
| `VITE_SUPABASE_URL` | frontend build | same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | frontend build | Supabase → Settings → API → `anon` |
| `VITE_API_URL` | frontend build | `/api` |

> `VITE_*` are baked into the client bundle at build time (public by design).
> Never put `SUPABASE_SERVICE_ROLE_KEY` or `GROQ_API_KEY` in a `VITE_*` var.

## Netlify
Config in [`netlify.toml`](netlify.toml). Builds `frontend/`, functions in
`netlify/functions/` (each declares its own `config.path`). Auto-deploys from `main`.

## Vercel (CLI)
Config in [`vercel.json`](vercel.json) + root [`package.json`](package.json).
`api/[...path].ts` is a catch-all that reuses the same function handlers.

```bash
npm i -g vercel
cd <repo-root>
vercel link
# set the 6 env vars (Production):
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add GROQ_API_KEY
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_API_URL          # = /api
vercel --prod
```

After deploy, add the production URL in **Supabase → Authentication → URL
Configuration** (Site URL + `…/**` redirect).

> Vercel blocks deploys whose commit-author email is not linked to a GitHub
> account. Use `git config user.email "<your-github-email>"` before committing.

## Supabase migrations
Run, in order, the files in [`supabase/migrations/`](supabase/migrations/)
via the Supabase SQL Editor: `0001` → `0002` → `0003` → `0004`.
