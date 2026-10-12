# Déploiement — Vercel + Supabase + Groq

```
[ Vercel ]    Frontend React (statique) + une fonction Node (server/, via api/[...path].ts)
[ Supabase ]  Postgres (schéma + RLS + pgvector) · Storage (CV) · Auth (staff & candidats)
[ Groq ]      LLM free tier — extraction des CV, assistant
[ Gemini ]    gemini-embedding-2 — recherche par le sens dans la base de connaissances (optionnel)
```

Aucun serveur ni conteneur à maintenir. Coût ≈ 0 sur les offres gratuites.

---

## 1. Variables d'environnement

| Variable | Portée | Valeur / source |
|---|---|---|
| `SUPABASE_URL` | API | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | API (**secret**) | Supabase → Settings → API → `service_role` |
| `GROQ_API_KEY` | API (**secret**) | console.groq.com → API Keys |
| `GROQ_MODEL` *(optionnel)* | API | modèle de l'assistant, défaut `openai/gpt-oss-120b` |
| `GROQ_EXTRACT_MODEL` *(optionnel)* | API | modèle d'extraction des CV, défaut `openai/gpt-oss-20b` |
| `GEMINI_API_KEY` *(recommandé)* | API (**secret**) | Google AI Studio (aistudio.google.com) → Get API key. Vectorise la base de connaissances (`gemini-embedding-2`, 768 dimensions) ; absente, l'assistant reste en recherche plein-texte |
| `VITE_SUPABASE_URL` | build frontend | identique à `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | build frontend | Supabase → Settings → API → `anon` |
| `VITE_API_URL` | build frontend | `/api` |
| `RESEND_API_KEY` | API (**secret**) | resend.com → API Keys |
| `MAIL_FROM` | API | ex. `Fondation Phosboucraa <stages@phosboucraa.org>` — le domaine doit être vérifié chez Resend |
| `OFFICE_NAME` | API | nom du bureau où déposer les documents |
| `OFFICE_ADDRESS` | API | adresse postale affichée dans l'e-mail |
| `OFFICE_CONTACT` | API | téléphone ou e-mail de contact |
| `DOCS_DEADLINE_DAYS` *(optionnel)* | API | entier, ex. `5` — omis, aucune phrase de délai |
| `CRON_SECRET` *(recommandé)* | API (**secret**) | chaîne aléatoire (`openssl rand -hex 32`). Exigée par les routes internes `/api/analyze-cv` et `/api/rag-embed` ; Vercel Cron l'envoie de lui-même. Absente, ces routes restent ouvertes |
| `RAG_DEBUG` *(optionnel)* | API | `1` : traces de diagnostic de l'assistant dans les logs |

> Les variables `VITE_*` sont **intégrées au bundle client** au build (publiques
> par conception). Ne mettez **jamais** `SUPABASE_SERVICE_ROLE_KEY`,
> `GROQ_API_KEY`, `GEMINI_API_KEY` ni `RESEND_API_KEY` dans une variable `VITE_*`.

> `RESEND_API_KEY`, `MAIL_FROM`, `OFFICE_*` et `DOCS_DEADLINE_DAYS` ne servent
> qu'à l'e-mail envoyé au stagiaire après un échange d'offre approuvé. Si
> `RESEND_API_KEY` ou `MAIL_FROM` manque, l'envoi est ignoré avec un
> avertissement dans les logs : **l'approbation elle-même aboutit quand même**.
> Non renseignées, les `OFFICE_*` s'affichent comme `[OFFICE_NAME — à renseigner]`.

## 2. Supabase (DB + Storage + Auth)

1. Créez (ou réutilisez) un projet Supabase.
2. **SQL Editor** → exécutez **dans l'ordre** tous les fichiers de
   [`supabase/migrations/`](supabase/migrations/), de `0001` au dernier.
   Les extensions nécessaires (`vector`, `pg_trgm`) sont créées par les
   migrations elles-mêmes. Points d'attention :
   - **`0014`** recopie les compétences de chaque candidat dans
     `candidates.skills_text` (quelques secondes sur une base peuplée).
   - **`0019`** reconstruit la base de connaissances de l'assistant
     (`rag_documents` / `rag_chunks`, recherche hybride) et **vide** l'ancienne.
   - **`0020`** retire le type de document « politique » (`cv` / `other` seulement).
   - **`0021`** rattache chaque CV à son candidat (profil détaillé, notes du
     recruteur, fonctions de lecture de l'assistant).
   - **`0022`** passe les vecteurs à Gemini (`gemini-embedding-2`, 768
     dimensions) : les anciens vecteurs Mistral sont effacés.
   - Ensuite, avec `GEMINI_API_KEY` en place, **réindexez** : bouton
     « Réindexer » de la page Assistant, ou `npm run reindex`.
3. **Authentication → Users → Add user** → créez votre compte admin
   (email + mot de passe **fort**). Puis dans **SQL Editor** :
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = '<votre-email-admin>');
   ```
4. **Project Settings → API** : notez `Project URL`, la clé **anon public** et
   la clé **service_role** (secrète).

## 3. Groq (LLM gratuit)

Créez une clé sur https://console.groq.com → **API Keys**. L'offre gratuite
plafonne `gpt-oss-120b` à 200 000 tokens **par jour** : au-delà, l'assistant
répond « limite d'utilisation atteinte, réessayez » jusqu'au renouvellement.

## 4. Vercel

Config dans [`vercel.json`](vercel.json) + [`package.json`](package.json)
racine. Au build, `scripts/bundle-api.mjs` regroupe `server/` dans
`api/_handler.cjs`, chargé par l'unique fonction `api/[...path].ts`.

```bash
npx vercel login
npx vercel link                      # projet pfa-v2
# renseignez les variables du § 1 (Production) :
npx vercel env add SUPABASE_URL
npx vercel env add SUPABASE_SERVICE_ROLE_KEY
npx vercel env add GROQ_API_KEY
npx vercel env add GEMINI_API_KEY
npx vercel env add VITE_SUPABASE_URL
npx vercel env add VITE_SUPABASE_ANON_KEY
npx vercel env add VITE_API_URL      # = /api
npx vercel env add CRON_SECRET
npx vercel --prod
```

> Les builds déclenchés par un push Git sont annulés sur ce projet : la mise en
> production se fait avec `npx vercel --prod`.

> Vercel bloque les déploiements dont l'email d'auteur du commit n'est pas lié
> à un compte GitHub : `git config user.email "<votre-email-github>"` avant de
> committer.

## 5. Après le déploiement

- Ajoutez l'URL de production dans **Supabase → Authentication → URL
  Configuration** (Site URL + redirect `…/**`).
- **Vérification** :
  - `/api/health` répond `{"ok": true, …}` et indique quelles clés la fonction voit.
  - Landing : les offres s'affichent (→ `public-offers` → Supabase OK).
  - **Postuler** sur une offre → upload d'un PDF → quelques secondes plus tard
    la candidature passe en *Analysée* (route de fond `/api/analyze-cv`).
  - `/login` → compte admin → Dashboard, Candidatures, Affectation IA, Assistant.

---

## Notes techniques

- **Auth** : Supabase Auth côté front ; l'API vérifie le JWT et le rôle
  (`profiles.role`) avec la clé service_role, qui contourne la RLS.
- **Upload** : URL signée (`create-upload-url`) → upload **direct** vers Supabase
  Storage (contourne la limite de taille des requêtes) → `submit-application`.
- **Tâches de fond** : `/api/analyze-cv` (analyse d'un CV) et `/api/rag-embed`
  (vectorisation) sont appelées sans attente, l'invocation restant en vie grâce à
  `waitUntil` (`server/lib/trigger-analysis.ts`) ; leur durée est bornée par
  `maxDuration` (300 s, `vercel.json`). Un Cron Vercel quotidien relance
  `/api/rag-embed` pour rattraper une vectorisation interrompue.
- **Chaîne CV** (`server/lib/cv-pipeline.ts`) : tout CV — candidature du portail,
  import en masse, dépôt depuis l'assistant — est lu page par page, analysé par
  Groq (profil détaillé compris), puis indexé dans la base de connaissances
  **sous le nom de son candidat**.
- **Matching** : compétences normalisées + niveau d'études + **Hongrois** en
  TypeScript (`server/lib/scoring.ts`, `server/lib/hungarian.ts`).
