# Rapport d'analyse du projet — Assistant IA de gestion des stages (OCP Phosboucraa)

> Généré le 2026-07-03 à partir d'une analyse complète du dépôt (code, migrations,
> CI, documentation, historique git).

---

## 1. Vue d'ensemble

**Projet de fin d'études (PFA)** pour PHOSBOUCRAA S.A. (Groupe OCP, Laâyoune) :
un assistant intelligent qui automatise la réception des demandes de stage, le
profilage NLP des candidats (CV/lettres), l'évaluation des besoins des
départements, et propose une **affectation optimale stagiaire → service** via
l'**algorithme Hongrois**. Le projet inclut une landing page publique, un espace
d'administration protégé par JWT, un portail candidat, un **assistant RAG
bilingue (FR/EN)** et un module de **prévision de capacité (XGBoost)**.

| Indicateur | Valeur |
|---|---|
| Commits | 56 (du 2026-06-18 au 2026-07-02, ~2 semaines d'activité intense) |
| Backend Python (`backend/app`) | ~5 000 lignes |
| Frontend TypeScript/React (`frontend/src`) | ~5 000 lignes |
| Fonctions serverless (`netlify/functions`) | ~2 900 lignes |
| Branche | `main` (unique, synchronisée avec `origin/main`) |

---

## 2. Architecture

Le dépôt contient en réalité **deux implémentations backend parallèles** du même
domaine métier, ciblant deux modes de déploiement :

### 2.1 Pile « complète » (Docker / Render)
```
[ React 18 + TS + Vite + Ant Design ]
              │  REST (JWT)
              ▼
[ FastAPI (Python 3.11) ] ──► [ Services IA + Celery workers ]
              │                          │
              ▼                          ▼
[ PostgreSQL + pgvector ]      [ Redis ]   [ MinIO (S3) ]
```
- `backend/` : FastAPI, SQLAlchemy 2 + Alembic (4 migrations), Pydantic v2,
  Celery + Redis, MinIO pour les CV.
- NLP « lourd » : spaCy (fr/en), Sentence-Transformers, FAISS, PyMuPDF,
  LLM optionnel via LangChain. Embeddings de CV mis en cache dans Redis.
- Orchestration : `docker-compose.yml`, reverse proxy `nginx/`,
  blueprint `render.yaml` (api + worker + beat + redis).

### 2.2 Pile « serverless » (Netlify / Vercel + Supabase)
- `netlify/functions/` : ~20 fonctions TypeScript (applications, matching,
  assistant RAG, forecast, users, portail candidat…) avec un noyau partagé
  `_shared/` (auth, scoring, hungarian, RAG, Groq, xgb-predict…).
- `api/[...path].ts` + `vercel-src/handler.ts` + `scripts/bundle-api.mjs` :
  le même handler bundlé par esbuild pour Vercel (catch-all, `maxDuration: 60`).
- Base : **Supabase** (8 migrations SQL dans `supabase/migrations/`, dont
  portail candidat, CRM admin, durcissement sécurité, cache d'analyse CV,
  base de connaissances RAG, recherche bilingue).
- LLM : **Groq** (extraction CV mise en cache par hash du texte) ;
  XGBoost entraîné hors-ligne (`scripts/train_forecast.py`) puis inféré en
  TypeScript via `forecast_model.json`.

Les deux piles partagent le même frontend, qui appelle `/api/v1` en chemin relatif
(proxy Netlify ou rewrites Vercel — pas de CORS).

---

## 3. Modules métier

| Module | Backend FastAPI | Serverless |
|---|---|---|
| Ingestion & parsing CV (PDF/DOCX) | PyMuPDF/pdfplumber + Celery `cv_analysis` | `unpdf`/`mammoth` + Groq (cache Supabase) |
| Profilage NLP | spaCy + gazetteer + Sentence-Transformers → pgvector | Groq structured extraction |
| Moteur d'affectation | `services/matching/` (scoring composite + `scipy.linear_sum_assignment`) | `_shared/hungarian.ts` + `scoring.ts` (portage TS) |
| Score composite | `0.5·sémantique + 0.35·compétences + 0.15·niveau` (pondérations ajustables UI) | idem |
| Assistant RAG | `services/rag/` (retriever pgvector, génération, détection de langue FR/EN) | `_shared/rag.ts` + migrations 0007/0008 |
| Prévision de capacité | `services/planning/forecast.py` (XGBoost réel) | `xgb-predict.ts` (modèle pré-entraîné embarqué) |
| Dashboard & KPIs | `api/v1/dashboard.py` | `dashboard.ts` |
| Notifications | Celery `notifications.py` | — |
| XAI | radar de décomposition du score (`ScoreBreakdownChart.tsx`) | idem (UI commune) |

**API v1 (FastAPI)** : `auth`, `public`, `departments`, `offers`, `candidates`,
`applications`, `matching`, `dashboard`, `planning`, `assistant` — avec intégrité
référentielle (« bloquer les parents, supprimer les feuilles », 409 explicites).

---

## 4. Frontend

- **Stack** : React 18, TypeScript strict, Vite, Redux Toolkit (auth),
  React Query, Ant Design (tokens centralisés), Recharts, React Hook Form + Zod.
- **Pages (12)** : Landing publique, Login, Signup, Dashboard, Candidatures,
  Candidats, Départements, Offres, Matching, **Assistant (RAG)**,
  **Portail candidat**, **Utilisateurs (CRM admin)**.
- **Thème** : identité « NVIDIA Build » avec bascule sombre/clair à chaud,
  fond constellation animé (`ConstellationCanvas`), thème entreprise clair
  centralisé via tokens AntD.
- **Qualité UX** : lazy-loading + `Suspense`, `ErrorBoundary` avec
  auto-récupération des chunks périmés, skeletons AntD sans saut de layout,
  splash accessible (`AppLoader`).
- Historique récent : plusieurs correctifs de robustesse auth (logout synchrone,
  boucle `SIGNED_OUT` figeant la page, suppression du `backdrop-filter` qui
  gelait le rendu au-dessus du mesh animé).

---

## 5. Données & sécurité

- **Schéma** : 12 modèles SQLAlchemy (candidate, application, offer, department,
  assignment, matching_run, document, document_chunk, skill, user, notification…)
  avec colonnes pgvector ; miroir SQL côté Supabase.
- **RLS deny-by-default** : migration Alembic `0002_enable_rls` bloque l'API
  PostgREST publique (`anon`) tout en laissant le backend (rôle `postgres`,
  `BYPASSRLS`) opérer ; migration Supabase `0005_security_hardening` renforce
  le côté serverless.
- **Auth** : JWT/OAuth2 + bcrypt (FastAPI) ; Supabase Auth côté serverless,
  avec rôles (admin/candidat).
- **Secrets** : `.env`, `.env.local` présents **en local uniquement** — seuls
  `.env.example` et `.env.supabase.example` sont versionnés. ✔️
- ⚠️ Points d'attention :
  - Identifiants admin par défaut (`admin@phosboucraa.ma` / `Admin@1234`)
    documentés dans le README — à changer impérativement en production.
  - `docs/biometric-attendance-compliance.md` (non commité) : cadrage
    **conformité Loi 09-08 / CNDP / RGPD** pour la présence biométrique —
    explicitement *scoping only*, aucun code tant que la base légale n'est
    pas validée. Démarche exemplaire.

---

## 6. Qualité, tests & CI/CD

**Pipeline GitHub Actions** (`.github/workflows/ci.yml`) — 3 jobs bloquants sur
PR et push vers `main` :

| Job | Contenu |
|---|---|
| backend | `ruff check` · `black --check` · `pytest -q` (Python 3.11) |
| frontend | `npm ci` · `tsc -b` + `vite build` (Node 22) |
| functions | `tsc --noEmit` · `vitest run` |

**Tests existants** :
- Backend : `test_matching.py` (scoring/Hongrois), `test_forecast.py`,
  `test_rag_router.py`, `test_embedding_cache.py`.
- Serverless : `capacity-forecast.test.ts`, `cv-cache.test.ts`, `rag.test.ts`,
  `xgb-predict.test.ts` (vitest).

`docs/devops.md` documente la protection de branche recommandée (PR obligatoire,
1 approbation, checks requis, pas de push direct). Les commits suivent la
convention **Conventional Commits** (`feat`, `fix`, `docs`, `ci`, `style`).

**Couverture ajoutée depuis ce rapport** : tests frontend (Vitest + Testing
Library, jsdom), tests d'intégration API (TestClient httpx + SQLite en mémoire)
et tests croisés de parité de scoring Python ↔ TypeScript. Reste à faire : la
mesure de couverture (c8 / pytest-cov) en CI.

---

## 7. État du dépôt (au 2026-07-03)

- Branche `main` propre vis-à-vis de l'origine ; modifications locales non
  commitées : `.gitignore`, `.claude/settings.local.json`, et deux fichiers
  non suivis (`deno.lock`, `docs/biometric-attendance-compliance.md`).
- Dossiers résiduels : `nvidia-models-clone/` (clone de référence pour le
  thème ?), `.netlify/`, `.vercel/` — à vérifier / ignorer si non nécessaires.
- Documentation riche : `README.md` (très complet), `DEPLOY.md`, `DEPLOYMENT.md`
  (doublon apparent à consolider), `SUPABASE_SETUP.md`, `docs/devops.md`,
  cadrage biométrie (FR + EN).

---

## 8. Points forts

1. **Double architecture assumée** (Docker complet vs serverless) avec parité
   fonctionnelle — rare pour un PFA, et bien documentée.
2. **IA appliquée de bout en bout** : NLP de profilage, embeddings pgvector,
   optimisation Hongroise explicable (XAI), RAG bilingue, forecast XGBoost.
3. **Sécurité réfléchie** : RLS deny-by-default, JWT/bcrypt, cadrage CNDP/RGPD
   avant tout code biométrique.
4. **Industrialisation** : CI 3 jobs, conventional commits, blueprint Render,
   caches (Redis embeddings, Supabase Groq), tests unitaires ciblés.
5. **UX soignée** : loading system complet, thème dual clair/sombre, skeletons.

## 9. Recommandations

| Priorité | Recommandation | Statut |
|---|---|---|
| Haute | Changer/désactiver le compte admin seedé en production ; forcer la rotation du `SECRET_KEY`. | ✅ Le seeder refuse désormais le mot de passe par défaut quand `ENVIRONMENT=production` (rotation `SECRET_KEY` : opérationnel, côté hébergeur) |
| Haute | Commiter ou finaliser les fichiers en attente (`docs/biometric-attendance-compliance.md`, `.gitignore`) ; décider du sort de `deno.lock`. | ✅ Doc biométrie fusionné, `.gitignore` assaini, `deno.lock` supprimé/ignoré |
| Moyenne | Consolider `DEPLOY.md` et `DEPLOYMENT.md` en un seul document. | ✅ Fusionnés dans `DEPLOYMENT.md` |
| Moyenne | Ajouter des tests frontend (Vitest + Testing Library) et des tests d'intégration API (httpx + base éphémère). | ✅ 9 tests UI (jsdom) + 14 tests d'intégration (TestClient httpx, SQLite en mémoire), branchés en CI |
| Moyenne | Factoriser la logique dupliquée entre `backend/app/services/matching` et `netlify/functions/_shared` (au minimum, tests croisés garantissant la parité des scores). | ✅ Tests croisés sur fixtures communes (`shared/fixtures/scoring-parity.json`) exécutés par pytest et vitest |
| Basse | Supprimer `nvidia-models-clone/` du dépôt de travail s'il n'est plus utile ; ajouter la mesure de couverture (c8 / pytest-cov) en CI. | ⏳ À faire |

---

*Rapport généré automatiquement — à relire avant diffusion.*
