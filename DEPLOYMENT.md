# Déploiement — serverless (Netlify ou Vercel) + Supabase + Groq

> Document unique de déploiement (fusion de l'ancien `DEPLOY.md` et de
> `DEPLOYMENT.md`).

```
[ Netlify / Vercel ]  Frontend React (statique) + fonctions serverless (TS) = le backend
[ Supabase ]          Postgres (schéma + RLS) · Storage (CV) · Auth (admin & candidats)
[ Groq ]              LLM free tier — extraction structurée des CV
```

Aucun serveur, Docker, Celery, Redis, MinIO ni PyTorch. Coût ≈ 0 (tiers gratuits).

> L'ancienne stack complète (`backend/` Python, `docker-compose.yml`,
> `render.yaml`) reste disponible pour un hébergement classique — voir le
> [README](README.md#-déploiement-en-production-netlify--backend-séparé).
> Ce document couvre la voie **serverless**, utilisée en production.

---

## 1. Variables d'environnement (Netlify comme Vercel)

| Variable | Portée | Valeur / source |
|---|---|---|
| `SUPABASE_URL` | fonctions | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | fonctions (**secret**) | Supabase → Settings → API → `service_role` |
| `GROQ_API_KEY` | fonctions | console.groq.com → API Keys |
| `GROQ_MODEL` *(optionnel)* | fonctions | ex. `llama-3.1-8b-instant` |
| `VITE_SUPABASE_URL` | build frontend | identique à `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | build frontend | Supabase → Settings → API → `anon` |
| `VITE_API_URL` | build frontend | `/api` |
| `RESEND_API_KEY` | fonctions (**secret**) | resend.com → API Keys |
| `MAIL_FROM` | fonctions | ex. `Fondation Phosboucraa <stages@phosboucraa.org>` — le domaine doit être vérifié chez Resend |
| `OFFICE_NAME` | fonctions | nom du bureau où déposer les documents |
| `OFFICE_ADDRESS` | fonctions | adresse postale affichée dans l'e-mail |
| `OFFICE_CONTACT` | fonctions | téléphone ou e-mail de contact |
| `DOCS_DEADLINE_DAYS` *(optionnel)* | fonctions | entier, ex. `5` — omis, aucune phrase de délai |

> Les variables `VITE_*` sont **intégrées au bundle client** au build (publiques
> par conception). Ne mettez **jamais** `SUPABASE_SERVICE_ROLE_KEY`,
> `GROQ_API_KEY` ni `RESEND_API_KEY` dans une variable `VITE_*`.

> Les six dernières variables ne servent qu'à l'e-mail envoyé au stagiaire
> après un échange d'offre approuvé. Si `RESEND_API_KEY` ou `MAIL_FROM`
> manque, l'envoi est ignoré avec un avertissement dans les logs :
> **l'approbation elle-même aboutit quand même**. Les trois `OFFICE_*`
> apparaissent en clair dans le message ; non renseignées, elles s'affichent
> comme `[OFFICE_NAME — à renseigner]`, visible sans être bloquant.

## 2. Supabase (DB + Storage + Auth)

1. Créez (ou réutilisez) un projet Supabase.
2. **SQL Editor** → exécutez **dans l'ordre** tous les fichiers de
   [`supabase/migrations/`](supabase/migrations/) : `0001` → `0015`.
   (Tables + RLS, données de démo, portail candidat, CRM admin, durcissement
   sécurité, cache d'analyse CV, base de connaissances RAG, recherche bilingue,
   période de stage, sémantique OU, conversations de l'assistant, échanges
   d'offre, correctif de requête RAG, recherche de candidats, ingestion atomique.)

   > **`0014` demande l'extension `pg_trgm`** (créée par la migration elle-même)
   > et effectue une **reprise de l'existant** : elle recopie les compétences de
   > chaque candidat dans `candidates.skills_text`, que des triggers maintiennent
   > ensuite. Sur une base déjà peuplée, comptez quelques secondes ; sans cette
   > reprise les profils déjà enregistrés sortiraient de toute recherche par
   > compétence.
3. **Authentication → Users → Add user** → créez votre compte admin
   (email + mot de passe **fort**). Puis dans **SQL Editor** :
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = '<votre-email-admin>');
   ```
4. **Project Settings → API** : notez `Project URL`, la clé **anon public** et
   la clé **service_role** (secrète).

## 3. Groq (LLM gratuit)

Créez une clé sur https://console.groq.com → **API Keys** (free tier).

## 4. Netlify (voie principale)

Config dans [`netlify.toml`](netlify.toml) : build de `frontend/`, fonctions
dans `netlify/functions/` (chacune déclare son `config.path`). Auto-déploiement
depuis `main`.

1. **Add new site → Import an existing project** → connectez le repo (Netlify
   détecte `netlify.toml`).
2. **Site settings → Environment variables** → ajoutez les variables du § 1.
3. **Deploy** (Netlify installe les deps de `netlify/functions/package.json`
   et bundle les fonctions avec esbuild).

## 5. Vercel (alternative, via CLI)

Config dans [`vercel.json`](vercel.json) + [`package.json`](package.json)
racine. `api/[...path].ts` est un catch-all qui réutilise les mêmes handlers
(bundlés par `scripts/bundle-api.mjs`).

```bash
npm i -g vercel
cd <repo-root>
vercel link
# renseignez les variables du § 1 (Production) :
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add GROQ_API_KEY
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_API_URL          # = /api
vercel --prod
```

> Vercel bloque les déploiements dont l'email d'auteur du commit n'est pas lié
> à un compte GitHub : `git config user.email "<votre-email-github>"` avant de
> committer.

## 6. Après le déploiement

- Ajoutez l'URL de production dans **Supabase → Authentication → URL
  Configuration** (Site URL + redirect `…/**`).
- **Vérification** :
  - Landing : les offres de démo s'affichent (→ `public-offers` → Supabase OK).
  - **Postuler** sur une offre → upload d'un PDF → confirmation ; quelques
    secondes plus tard la candidature passe en *Analysée* (Groq + background
    function).
  - `/login` → compte admin → Dashboard, Candidatures, **Affectation IA**
    (Hongrois).

---

## Notes techniques

- **Auth** : Supabase Auth côté front (`@supabase/supabase-js`) ; les fonctions
  vérifient le JWT et le rôle (`profiles.role`) avec la clé service_role (qui
  bypass la RLS).
- **Upload** : URL signée (`create-upload-url`) → upload **direct** vers
  Supabase Storage (contourne la limite ~6 Mo des fonctions) →
  `submit-application`.
- **Analyse CV** : `analyze-application-background` (Netlify *Background
  Function*, ≤ 15 min) — `unpdf`/`mammoth` pour le texte, **Groq** pour
  l'extraction structurée (mise en cache par hash du texte).
- **Matching** : compétences (normalisées par Groq) + niveau d'études +
  **Hongrois** en TS (`_shared/hungarian.ts`). Pas d'embeddings côté serverless
  (Groq ne fournit pas de modèle vectoriel) ; la parité des composants de score
  avec le backend Python est verrouillée par des tests croisés
  (`shared/fixtures/scoring-parity.json`).
- **Rate limiting** : au besoin via la *Rate limiting* native de Netlify
  (Site config → Functions) sur `create-upload-url` / `submit-application`.
