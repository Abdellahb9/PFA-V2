# Déploiement — 100 % serverless (Netlify + Supabase + Groq)

```
[ Netlify ]  Frontend React (statique)  +  Netlify Functions (TS) = le backend
[ Supabase ] Postgres (schéma) · Storage (CV) · Auth (admin)
[ Groq ]     LLM free tier — extraction des CV
```
Aucun serveur, Docker, Celery, Redis, MinIO ni PyTorch. Coût ≈ 0 (tiers gratuits).

> L'ancienne stack (`backend/` Python, `docker-compose.yml`, `render.yaml`) est
> **remplacée** par cette version serverless et peut être ignorée/supprimée.

---

## 1. Pousser le code sur GitHub
```bash
git init && git add . && git commit -m "Serverless app"
git branch -M main
git remote add origin https://github.com/<vous>/<repo>.git
git push -u origin main
```

## 2. Supabase (DB + Storage + Auth)
1. Créez (ou réutilisez) un projet Supabase.
2. **SQL Editor** → exécutez `supabase/migrations/0001_init.sql` puis `0002_seed.sql`.
   (Crée les tables, la RLS, le bucket `documents` et des données de démo.)
3. **Authentication → Users → Add user** → créez votre compte admin (email + mot de passe).
   Puis dans **SQL Editor** :
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = '<votre-email-admin>');
   ```
4. **Project Settings → API** : notez `Project URL`, la clé **anon public** et la clé
   **service_role** (secrète).

## 3. Groq (LLM gratuit)
Créez une clé sur https://console.groq.com → **API Keys**. (Free tier.)

## 4. Netlify
1. **Add new site → Import an existing project** → connectez le repo. Netlify détecte
   `netlify.toml` (build `frontend`, fonctions `netlify/functions`).
2. **Site settings → Environment variables** → ajoutez :
   | Variable | Valeur | Utilisée par |
   |---|---|---|
   | `VITE_SUPABASE_URL` | Project URL | build (frontend) |
   | `VITE_SUPABASE_ANON_KEY` | clé anon | build (frontend) |
   | `SUPABASE_URL` | Project URL | fonctions |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé service_role | fonctions |
   | `GROQ_API_KEY` | clé Groq | fonctions |
   | `GROQ_MODEL` *(optionnel)* | `llama-3.1-8b-instant` | fonctions |
3. **Deploy**. (Netlify installe les deps de `netlify/functions/package.json` et bundle
   les fonctions avec esbuild.)

## 5. Vérification
- Page d'accueil : la landing affiche les offres de démo (→ `public-offers` → Supabase OK).
- **Postuler** sur une offre → upload d'un PDF → message de confirmation. Quelques
  secondes plus tard la candidature passe en *Analysée* (Groq + background function).
- `/login` → votre compte admin → Dashboard, Candidatures, **Affectation IA** (Hongrois).

---

## Notes techniques
- **Auth** : Supabase Auth côté front (`@supabase/supabase-js`) ; les fonctions vérifient
  le JWT et le rôle (`profiles.role`) avec la clé service_role (qui bypass la RLS).
- **Upload** : URL signée (`create-upload-url`) → upload **direct** vers Supabase Storage
  (contourne la limite ~6 Mo des fonctions) → `submit-application`.
- **Analyse CV** : `analyze-application-background` (Netlify *Background Function*, ≤ 15 min) —
  `unpdf`/`mammoth` pour le texte, **Groq** pour l'extraction structurée.
- **Matching** : compétences (normalisées par Groq) + niveau d'études + **Hongrois** en TS
  (`_shared/hungarian.ts`). Pas d'embeddings (Groq ne fournit pas de modèle vectoriel).
- **Rate limiting** : ajoutez-le au besoin via la *Rate limiting* native de Netlify
  (Site config → Functions) sur `create-upload-url` / `submit-application`.
