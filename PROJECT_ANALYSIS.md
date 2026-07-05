# PROJECT_ANALYSIS.md — Assistant IA PHOSBOUCRAA

> Generated 2026-07-03. Exhaustive analysis of the repository at commit `3a925c2` (branch `main`).

---

## 1. Technologies Used

The project is a **dual-backend monorepo**: a fully serverless production stack (React + Netlify/Vercel Functions + Supabase + Groq) and a legacy self-hosted stack (FastAPI + Celery + Docker) kept for the pgvector/spaCy/XGBoost feature set.

| Category | Technology | Version | Purpose |
|---|---|---|---|
| **Language** | TypeScript | 5.6–5.7 | Frontend, serverless functions, Vercel bridge |
| **Language** | Python | ≥3.11 | FastAPI backend, Celery tasks, ML training scripts |
| **Language** | SQL (PostgreSQL) | — | Supabase migrations, Alembic migrations |
| **Frontend** | React | 18.3 | SPA UI |
| **Frontend** | Vite | 6.0 | Dev server + build |
| **Frontend** | Ant Design (antd) | 5.22 | Component library, dark/light NVIDIA theming |
| **Frontend** | Redux Toolkit + react-redux | 2.5 / 9.2 | Auth/session state |
| **Frontend** | TanStack React Query | 5.62 | Server-state caching for all API calls |
| **Frontend** | React Router | 6.28 | Routing (public/candidate/admin areas) |
| **Frontend** | React Hook Form + Zod | 7.54 / 3.24 | Forms + validation |
| **Frontend** | Recharts | 2.15 | Dashboard charts, score-breakdown radar |
| **Frontend** | Axios | 1.7 | HTTP client (JWT interceptor) |
| **Serverless** | Netlify Functions (Web API handlers) | @netlify/functions 2.8 | API endpoints (`/api/*`) |
| **Serverless** | Vercel Functions | @vercel/functions 1.5 | Same handlers re-bundled via esbuild catch-all |
| **Serverless** | groq-sdk | 0.9 | LLM CV extraction + RAG answer generation (Groq) |
| **Serverless** | unpdf / mammoth | 0.12 / 1.8 | PDF / DOCX text extraction in functions |
| **Backend (legacy)** | FastAPI | 0.115 | REST API (`/api/v1/*`) |
| **Backend (legacy)** | SQLAlchemy + Alembic | 2.0 / 1.14 | ORM + migrations |
| **Backend (legacy)** | Celery + Redis | 5.4 / 5.2 | Async CV analysis, matching, RAG ingestion |
| **Backend (legacy)** | spaCy + sentence-transformers | 3.8 / 3.3 | NLP CV parsing + embeddings (pgvector) |
| **Backend (legacy)** | XGBoost + pandas + scikit-learn | 2.1 / 2.2 / 1.6 | Capacity-demand forecasting |
| **Backend (legacy)** | MinIO | 7.2 | S3-compatible CV storage |
| **Database** | Supabase (PostgreSQL 15+) | — | Prod DB + Auth + Storage (serverless stack) |
| **Database** | PostgreSQL + pgvector | — | Docker DB for the FastAPI stack |
| **Testing** | Vitest | 2.1 (functions) / 3.2 (frontend) | Unit/integration tests |
| **Testing** | Testing Library (react/dom/jest-dom/user-event) | 16 / 10 / 6 / 14 | Component tests |
| **Testing** | pytest | latest | Backend tests (25 tests) |
| **Lint/format** | ruff + black | — | Python lint/format (CI-enforced) |
| **Lint/format** | ESLint | — | Frontend lint |
| **Build** | esbuild | 0.24 | Bundles Netlify handlers into `api/_handler.cjs` for Vercel |
| **Package manager** | npm | — | All JS workspaces (separate package.json per app) |
| **Package manager** | pip | — | Backend (`requirements.txt`) |
| **External service** | Supabase Auth | — | User authentication (JWT), roles admin/staff/candidate |
| **External service** | Supabase Storage | — | CV uploads (signed URLs) |
| **External service** | Groq API | llama models | CV field extraction, RAG generation |
| **External service** | Mistral / OpenAI (optional) | — | Legacy backend LLM extraction fallback |
| **DevOps** | Docker + docker-compose | — | Full legacy stack (8 services) |
| **DevOps** | GitHub Actions | — | CI: backend (ruff/black/pytest), frontend (tsc/build), functions (tsc/vitest) |
| **DevOps** | Vercel | — | Production hosting (frontend + api catch-all) |
| **DevOps** | Netlify | — | Alternative serverless hosting (same handlers) |
| **DevOps** | Render | render.yaml | Optional FastAPI + Celery + Redis blueprint |
| **DevOps** | Nginx | — | Frontend container serving (Docker stack) |

---

## 2. Project Structure

```
PFA/
├── .claude/                        # Claude Code local settings + dev-server launch config
│   ├── launch.json
│   └── settings.local.json
├── .env.example                    # Docker/FastAPI stack environment template
├── .env.supabase.example           # Same, pre-annotated for Supabase hosting
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI: 3 jobs (backend, frontend, serverless functions)
├── .gitignore
├── .vercelignore
├── DEPLOYMENT.md                   # Consolidated deployment guide
├── README.md                       # Project overview and quickstart
├── SUPABASE_SETUP.md               # Supabase project setup walkthrough
├── api/
│   ├── [...path].ts                # Vercel catch-all: delegates to the esbuild bundle
│   └── _handler.cjs                # Generated bundle of all Netlify handlers (committed)
├── backend/                        # Legacy self-hosted FastAPI stack (dormant in prod)
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   │       ├── 0001_initial_schema.py    # All core tables
│   │       ├── 0002_enable_rls.py        # Row-level security
│   │       ├── 0003_index_foreign_keys.py
│   │       └── 0004_document_chunks.py   # pgvector RAG chunks table
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py             # get_current_user / role dependencies
│   │   │   └── v1/
│   │   │       ├── applications.py # CRUD + status transitions + document upload
│   │   │       ├── assistant.py    # RAG query + knowledge documents endpoints
│   │   │       ├── auth.py         # JWT login/refresh/me
│   │   │       ├── candidates.py   # Candidate CRUD + profiles
│   │   │       ├── dashboard.py    # KPI + chart aggregation payload
│   │   │       ├── departments.py  # Department CRUD
│   │   │       ├── matching.py     # Matching runs + assignment validation
│   │   │       ├── offers.py       # Internship offer CRUD
│   │   │       ├── planning.py     # XGBoost capacity forecast endpoint
│   │   │       ├── public.py       # Unauthenticated offer listing/apply
│   │   │       └── router.py       # Aggregates all v1 routers
│   │   ├── core/
│   │   │   ├── celery_app.py       # Celery instance + task registration
│   │   │   ├── config.py           # Pydantic Settings (env-driven)
│   │   │   ├── database.py         # SQLAlchemy engine/session
│   │   │   ├── rate_limit.py       # Simple in-memory rate limiting
│   │   │   └── security.py         # bcrypt + JWT helpers
│   │   ├── crud/
│   │   │   ├── seed.py             # First-admin bootstrap (refuses default pwd in prod)
│   │   │   └── skill.py            # get_or_create_skill
│   │   ├── main.py                 # FastAPI app entry (CORS, routers, startup)
│   │   ├── models/                 # SQLAlchemy models (one file per entity)
│   │   │   ├── application.py • assignment.py • candidate.py • department.py
│   │   │   ├── document.py • document_chunk.py • matching_run.py • mixins.py
│   │   │   └── notification.py • offer.py • skill.py • user.py
│   │   ├── schemas/                # Pydantic response/request models (per entity)
│   │   │   ├── application.py • assistant.py • auth.py • candidate.py • common.py
│   │   │   └── dashboard.py • department.py • matching.py • offer.py • skill.py
│   │   ├── services/
│   │   │   ├── matching/
│   │   │   │   ├── hungarian.py    # Hungarian algorithm (scipy) for global assignment
│   │   │   │   ├── scoring.py      # Weighted candidate↔offer scoring (breakdown)
│   │   │   │   └── service.py      # Orchestrates matching runs
│   │   │   ├── nlp/
│   │   │   │   ├── embeddings.py   # sentence-transformers + Redis cache
│   │   │   │   ├── llm.py          # Mistral/OpenAI structured extraction
│   │   │   │   ├── parser.py       # PDF/DOCX text extraction
│   │   │   │   ├── pipeline.py     # CV → profile pipeline (spaCy + LLM + gazetteer)
│   │   │   │   └── skills_db.py    # Curated skills gazetteer (FR/EN aliases)
│   │   │   ├── planning/
│   │   │   │   └── forecast.py     # XGBoost demand forecast + slot recommendation
│   │   │   ├── rag/
│   │   │   │   ├── generation.py   # Answer templating/generation
│   │   │   │   ├── ingest.py       # Chunk + embed knowledge documents
│   │   │   │   ├── language.py     # FR/EN detection
│   │   │   │   ├── retriever.py    # pgvector similarity retrieval
│   │   │   │   └── router.py       # Skill routing (candidates / scores / policy)
│   │   │   └── storage.py          # MinIO upload/download/presign
│   │   └── tasks/
│   │       ├── cv_analysis.py      # Celery: parse CV → candidate profile
│   │       ├── matching_tasks.py   # Celery: run matching
│   │       ├── notifications.py    # Celery: notification fan-out
│   │       └── rag_ingestion.py    # Celery: ingest knowledge document
│   ├── pyproject.toml              # ruff/black/pytest config (pythonpath=["."])
│   ├── requirements.txt
│   ├── scripts/init_db.sql         # DB bootstrap (extensions)
│   └── tests/                      # pytest suite (8 files, 25 tests)
│       ├── conftest.py
│       ├── test_api_integration.py • test_embedding_cache.py • test_forecast.py
│       └── test_matching.py • test_rag_router.py • test_scoring_parity.py
├── docker-compose.yml              # 8 services: db, redis, minio(+init), backend,
│                                   # celery-worker, celery-beat, frontend
├── docs/
│   ├── biometrie-presence-conformite.md  # Biometric attendance: legal/compliance design (no code)
│   ├── devops.md                   # CI + branch protection guide
│   └── rapport-projet.md           # Project report (architecture/quality) [deleted locally]
├── frontend/                       # React SPA (deployed to Vercel/Netlify)
│   ├── .env.example                # VITE_API_URL + Supabase public keys
│   ├── Dockerfile • nginx.conf     # Container build for the Docker stack
│   ├── index.html                  # Entry HTML (pre-mount bg on <html>)
│   ├── package.json • tsconfig.json • tsconfig.node.json • vite.config.ts
│   └── src/
│       ├── App.tsx                 # Routes: landing, login/signup, candidate portal, admin
│       ├── main.tsx                # Bootstrap: Redux + React Query + ThemeProvider
│       ├── config.ts               # SHOW_CONSTELLATION flag
│       ├── index.css               # Global styles, base bg on <html>, animations
│       ├── api/
│       │   ├── client.ts           # Axios instance (Supabase JWT header)
│       │   ├── hooks.ts            # All React Query hooks (CRUD + assistant + forecast)
│       │   ├── types.ts            # API TypeScript types
│       │   └── upload.ts           # Storage-first application submission
│       ├── assets/phosboucraa-logo.png
│       ├── components/
│       │   ├── AppLoader.tsx • RouteFallback.tsx • FadeIn.tsx • ErrorBoundary.tsx
│       │   ├── BackgroundLayer.tsx      # NVIDIA constellation background (theme-aware)
│       │   ├── ConstellationCanvas.tsx  # Canvas mesh animation (30fps, reduced-motion)
│       │   ├── ThemeToggle.tsx          # Dark/light NVIDIA switch
│       │   ├── Layout.tsx               # Admin shell (sidebar + header)
│       │   ├── ProtectedRoute.tsx       # Auth/role guard
│       │   ├── KpiCard.tsx • SkeletonTable.tsx • ScoreBreakdownChart.tsx
│       │   ├── CapacityForecastPanel.tsx
│       │   ├── DepartmentFormModal.tsx • NewApplicationModal.tsx
│       │   ├── OffersBrowser.tsx • PublicApplicationModal.tsx
│       │   └── __tests__/               # 3 component test files
│       ├── lib/supabase.ts         # Supabase browser client
│       ├── pages/                  # 12 route pages (Landing, Login, Signup, Dashboard,
│       │                           # Applications, Candidates, Departments, Offers,
│       │                           # Matching, Users, CandidatePortal, Assistant)
│       ├── store/                  # Redux store + authSlice (Supabase session)
│       ├── test/setup.ts           # Vitest jsdom setup
│       └── theme/
│           ├── ThemeProvider.tsx   # Mode context + localStorage + <html> bg sync
│           └── themes.ts           # darkTheme / lightTheme / modeVisuals
├── netlify.toml                    # Netlify build + functions + SPA redirect
├── netlify/functions/              # THE serverless API (shared by Netlify & Vercel)
│   ├── package.json • tsconfig.json
│   ├── _shared/
│   │   ├── auth.ts                 # Supabase JWT verification + role checks
│   │   ├── supabase.ts • db.ts     # Service-role client + query helpers
│   │   ├── http.ts                 # JSON/error response helpers
│   │   ├── groq.ts                 # Groq chat completion wrapper
│   │   ├── cv.ts                   # PDF/DOCX extraction + CV analysis via Groq
│   │   ├── cv-cache.ts (+test)     # SHA-256 keyed Groq result cache (Supabase table)
│   │   ├── skills.ts               # Skills gazetteer (TS port)
│   │   ├── scoring.ts (+parity test) # Candidate↔offer scoring (parity with Python)
│   │   ├── hungarian.ts            # Hungarian algorithm (TS port)
│   │   ├── rag.ts (+test)          # Serverless RAG: skill routing + FTS retrieval + Groq
│   │   ├── xgb-predict.ts (+test)  # Pure-TS XGBoost tree-walker inference
│   │   └── forecast_model.json     # Offline-trained XGBoost model (JSON export)
│   ├── applications.ts • assignments.ts • candidates.ts • departments.ts
│   ├── offers.ts • users.ts • dashboard.ts • public-offers.ts
│   ├── my-applications.ts • submit-application.ts • create-upload-url.ts
│   ├── analyze-application-background.ts   # Async CV analysis (background function)
│   ├── matching-run.ts • matching-runs.ts • offer-rankings.ts
│   ├── capacity-forecast.ts (+test)        # XGBoost forecast endpoint
│   └── assistant.ts                        # RAG query + knowledge documents endpoints
├── nginx/nginx.conf                # Reverse proxy for the Docker stack
├── nvidia-models-clone/            # Standalone side project: NVIDIA "models" page clone
│   └── (Vite + React + Tailwind app with its own package.json/vercel.json)
├── package.json                    # Root: Vercel build wrapper (bundle-api + frontend build)
├── render.yaml                     # Render blueprint (FastAPI + Celery + Redis)
├── scripts/
│   ├── bundle-api.mjs              # esbuild: Netlify handlers → api/_handler.cjs
│   └── train_forecast.py           # Offline XGBoost training → forecast_model.json
├── shared/fixtures/scoring-parity.json  # Cross-stack scoring parity fixture (TS ↔ Python)
├── supabase/migrations/            # Supabase SQL migrations (applied via SQL editor)
│   ├── 0001_init.sql               # Core tables
│   ├── 0002_seed.sql               # Seed data
│   ├── 0003_candidate_portal.sql   # Candidate-facing tables/policies
│   ├── 0004_admin_crm.sql          # Admin CRM additions
│   ├── 0005_security_hardening.sql # RLS hardening
│   ├── 0006_cv_analysis_cache.sql  # Groq CV-analysis cache table
│   ├── 0007_rag_knowledge_base.sql # document_chunks + French FTS + search RPC
│   └── 0008_bilingual_search.sql   # FR+EN combined tsvector + bilingual RPC
├── tsconfig.api.json               # TS config for the Vercel bridge
├── vercel.json                     # Vercel build + rewrites + function config
└── vercel-src/handler.ts           # Node→Web request bridge for reused handlers
```

### Folder purposes

| Path | Purpose |
|---|---|
| `frontend/` | The single React SPA used by all deployments |
| `netlify/functions/` | **Canonical serverless API** — every endpoint lives here once |
| `api/` + `vercel-src/` + `scripts/bundle-api.mjs` | Vercel adapter: bundles the Netlify handlers into one catch-all function |
| `backend/` | Full-featured FastAPI/Celery stack (pgvector, spaCy, MinIO) — Docker/Render only, not deployed to Vercel |
| `supabase/migrations/` | Schema for the serverless stack (Supabase-hosted Postgres) |
| `backend/alembic/` | Schema for the self-hosted stack (mirrors Supabase where features overlap) |
| `shared/fixtures/` | Language-neutral test fixtures guaranteeing TS/Python scoring parity |
| `docs/` | Compliance design (biometrics), DevOps guide, project report |
| `nvidia-models-clone/` | Unrelated standalone UI clone experiment (own build, own deploy) |

---

## 3. Project Overview

**Assistant IA PHOSBOUCRAA** is an internship-application management platform built for the Phosboucraa Foundation (OCP group, Morocco). It solves the manual, slow triage of internship applications:

- **Candidates** browse public internship offers, create an account, upload a CV and apply.
- **The system** automatically extracts a structured profile from the CV (skills, education, experience) using an LLM, scores each candidate against each offer (skills match, education, experience, department fit) with an explainable breakdown, and proposes a **globally optimal assignment** (Hungarian algorithm) of candidates to offer slots.
- **Staff/admins** review applications, validate AI-proposed assignments, manage departments/offers/users, consult a KPI dashboard, ask a **RAG assistant** natural-language questions (candidate search, score explanations, internship-policy Q&A over uploaded documents), and get **XGBoost demand forecasts** to plan department capacity.

Target users: the Foundation's HR/internship staff (admin UI, French) and student applicants (public portal, French).

---

## 4. Architecture

**Style:** layered monorepo with **two interchangeable backends** exposing the same domain:

1. **Serverless (production)** — stateless functions, managed services:
```
Browser (React SPA, Vercel/Netlify CDN)
  → /api/* (Netlify Functions | Vercel catch-all bundling the same handlers)
      → _shared/auth.ts  (Supabase JWT verification, role check)
      → _shared/db.ts    (supabase-js, SERVICE ROLE)
      → Supabase Postgres (RLS ON; anon has no direct table access)
      → Supabase Storage  (CV files via signed upload URLs)
      → Groq API          (CV extraction, RAG generation) [cached by SHA-256 in Postgres]
```
CV analysis flow: `submit-application` → storage upload → `analyze-application-background` (async) → Groq (or cache hit) → profile + scores persisted.

2. **Self-hosted (Docker/Render)** — classic queue architecture:
```
Browser → Nginx → FastAPI (/api/v1) → SQLAlchemy → PostgreSQL(pgvector)
                        ↘ Celery (Redis broker) → spaCy/LLM pipeline → MinIO (CVs)
                                               → sentence-transformers → pgvector (RAG)
                                               → XGBoost (capacity forecast)
```

**Cross-stack parity** is enforced by `shared/fixtures/scoring-parity.json`: the TS (`_shared/scoring.ts`) and Python (`services/matching/scoring.py`) scorers are tested against the same fixture.

---

## 5. Dependencies

### Root `package.json` (Vercel wrapper)
- **prod:** `@supabase/supabase-js@^2.47`, `@vercel/functions@^1.5`, `groq-sdk@^0.9`, `mammoth@^1.8`, `unpdf@^0.12`, `ws@^8.18`, `zod@^3.24`
- **dev:** `@netlify/functions@^2.8`, `@types/node@^22`, `@types/ws@^8.5`, `esbuild@^0.24`, `typescript@^5.6`

### `frontend/package.json`
- **prod:** `@ant-design/icons@^5.5`, `@hookform/resolvers@^3.10`, `@reduxjs/toolkit@^2.5`, `@supabase/supabase-js@^2.47`, `@tanstack/react-query@^5.62`, `antd@^5.22`, `axios@^1.7`, `dayjs@^1.11`, `react@^18.3`, `react-dom@^18.3`, `react-hook-form@^7.54`, `react-redux@^9.2`, `react-router-dom@^6.28`, `recharts@^2.15`, `zod@^3.24`
- **dev:** `@testing-library/{dom,jest-dom,react,user-event}`, `@types/{node,react,react-dom}`, `@vitejs/plugin-react@^4.3`, `jsdom@^26`, `typescript@^5.7`, `vite@^6.0`, `vitest@^3.2`

### `netlify/functions/package.json`
- **prod:** `@supabase/supabase-js@^2.47`, `groq-sdk@^0.9`, `mammoth@^1.8`, `unpdf@^0.12`, `ws@^8.18`, `zod@^3.24`
- **dev:** `@netlify/functions@^2.8`, `@types/node@^22`, `@types/ws@^8.5`, `debug@^4.4`, `typescript@^5.7`, `vitest@^2.1`

### `backend/requirements.txt` (pinned)
- **Web:** fastapi 0.115.6, uvicorn 0.34.0, python-multipart, pydantic 2.10.4, pydantic-settings
- **DB:** sqlalchemy 2.0.36, alembic 1.14.0, psycopg[binary] 3.2.3, pgvector 0.3.6
- **Auth:** bcrypt 4.2.1, python-jose 3.3.0, email-validator
- **Queue:** celery 5.4.0, redis 5.2.1 · **Storage:** minio 7.2.13
- **NLP/AI:** spacy 3.8.2, sentence-transformers 3.3.1, faiss-cpu 1.9.0, scikit-learn 1.6.0, scipy 1.14.1, numpy 1.26.4
- **Forecast:** xgboost 2.1.3, pandas 2.2.3, langchain 0.3.13, langchain-community 0.3.13
- **Parsing:** pymupdf 1.25.1, pdfplumber 0.11.4, python-docx 1.1.2
- **Utils:** httpx 0.28.1, tenacity 9.0.0

### Notes on outdated/questionable packages
- `python-jose` is low-maintenance; `PyJWT` or `joserfc` are more actively maintained alternatives.
- `langchain`/`langchain-community` are declared but barely used — candidates for removal (heavy dependency tree).
- `faiss-cpu` appears unused now that retrieval is pgvector/FTS — candidate for removal.
- Frontend `vite@6` + `vitest@3` vs functions `vitest@2` — version drift, harmless but worth aligning.
- Two Groq/Supabase dependency copies (root vs `netlify/functions`) must be kept in sync manually.

---

## 6. Entry Points & Execution Flow

| Entry | Boot flow |
|---|---|
| `frontend/src/main.tsx` | ReactDOM → Redux `Provider` → React Query → `ThemeProvider` (AntD ConfigProvider, dark/light) → `BrowserRouter` → `App` |
| `frontend/src/App.tsx` | Detects persisted Supabase session → `fetchMe` → routes: `/` landing, `/login`, `/inscription`, `/mon-espace` (candidate), admin area behind `ProtectedRoute staffOnly` (dashboard, candidatures, candidats, départements, offres, matching, assistant, utilisateurs) |
| `netlify/functions/*.ts` | Each file exports a Web-API handler + `config.path`; Netlify routes natively |
| `api/[...path].ts` (Vercel) | Imports `api/_handler.cjs` (esbuild bundle of every Netlify handler + a route table) — built by `scripts/bundle-api.mjs` during `vercel-build` |
| `backend/app/main.py` | FastAPI app: CORS → `api_router` (v1) → startup seed (first admin; refuses default password in production) |
| `backend/app/core/celery_app.py` | Celery worker/beat: `cv_analysis`, `matching_tasks`, `notifications`, `rag_ingestion` |
| `scripts/train_forecast.py` | Offline: trains XGBoost on (synthetic or Supabase) history → `forecast_model.json` |

---

## 7. Modules / Components Breakdown

### Serverless API (`netlify/functions/`)
- **`_shared/auth.ts`** — verifies the Supabase JWT from `Authorization: Bearer`, loads the profile row, enforces `staff`/`admin` roles. All non-public endpoints call it first.
- **`_shared/db.ts` / `supabase.ts`** — service-role client (bypasses RLS server-side; anon policies are deliberately empty).
- **`_shared/cv.ts` + `cv-cache.ts`** — extract text (unpdf/mammoth), call Groq for structured profile extraction; results cached in Postgres keyed by SHA-256 of the CV text (idempotent re-analysis, cost control).
- **`_shared/scoring.ts` + `hungarian.ts`** — candidate↔offer scoring with per-factor breakdown; Hungarian algorithm for globally optimal slot assignment. Parity-tested against the Python implementation.
- **`_shared/rag.ts`** — the serverless RAG: classifies the query (Groq) into candidate-search / score-explanation / policy-QA; retrieval is Postgres full-text search (bilingual FR+EN tsvector, migration 0008) via the `search_document_chunks` RPC; generation via Groq with a "answer only from provided data" system prompt.
- **`_shared/xgb-predict.ts`** — dependency-free XGBoost inference: walks the exported tree JSON (`forecast_model.json`), verified equal to Python XGBoost output.
- **Endpoint files** — thin: parse/validate (zod) → auth → `_shared` logic → JSON response.

### Frontend
- **`api/hooks.ts`** — single home for all server interactions (React Query). Mutations invalidate the right query keys.
- **`store/authSlice.ts`** — Supabase session lifecycle (login/logout/fetchMe/sessionCleared).
- **`theme/`** — runtime dark/light NVIDIA theme; `modeVisuals` drives the constellation background intensity; mode persisted in localStorage and applied to `<html>` background.
- **`components/BackgroundLayer.tsx` + `ConstellationCanvas.tsx`** — fixed z-index −10 animated mesh; 30 fps throttle, tab-visibility pause, `prefers-reduced-motion` static frame.
- **Pages** — one file per route; admin pages compose AntD tables/modals + hooks; `MatchingPage` renders score breakdowns (radar) and assignment validation; `AssistantPage` is the RAG chat + knowledge-base manager.

### Legacy backend (`backend/app/`)
- Mirrors the same domain with richer NLP: spaCy pipeline + gazetteer + optional LLM for extraction, sentence-transformer embeddings with Redis cache, pgvector retrieval for RAG, Celery for all async work, MinIO for files, XGBoost trained in-process.

---

## 8. Database & Data Models

Two parallel schemas (Supabase SQL vs Alembic) covering the same entities:

| Entity | Purpose | Key relations |
|---|---|---|
| `users` / profiles | Auth identity + role (`admin`, `staff`, `candidate`) | 1–1 candidate |
| `candidates` | Structured profile (education level, field, years experience) | 1–N applications, N–M skills |
| `skills` + `candidate_skills` | Curated skill taxonomy + candidate links | — |
| `departments` | Org units with `capacity` | 1–N offers |
| `internship_offers` | Offer with `slots`, status, required skills | 1–N applications |
| `applications` | Candidate→offer application, status machine (`submitted → parsing → parsed → under_review → assigned/rejected/failed`) | 1–N documents |
| `documents` | Uploaded files (CVs) with storage keys | — |
| `assignments` | AI-proposed/validated candidate↔offer matches with `match_score` + breakdown | — |
| `matching_runs` | Batch matching executions + status | 1–N assignments |
| `notifications` | Outbound notifications queue (legacy stack) | — |
| `document_chunks` | RAG knowledge base: chunked policy docs. Supabase version: generated bilingual `tsvector` + GIN index + `search_document_chunks(q, top_k)` RPC. Backend version: pgvector embeddings | — |
| CV analysis cache (0006) | Groq output keyed by CV-text SHA-256 | — |

Migrations: `supabase/migrations/0001–0008` (apply in order via SQL editor; idempotent) and `backend/alembic/versions/0001–0004` (`alembic upgrade head`). RLS is enabled everywhere on Supabase; serverless functions use the service-role key, browsers never query tables directly (except auth/storage).

---

## 9. APIs & Routes

### Serverless API (`/api/*`) — production

| Method(s) | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/public-offers` | none | Public offer listing for the landing page |
| POST | `/api/submit-application` | none | Public application submit (rate-limited, storage-first) |
| POST | `/api/create-upload-url` | none/candidate | Signed Supabase Storage upload URL for a CV |
| — | `/api/analyze-application-background` | internal | Async CV analysis (Groq, cached) |
| GET | `/api/my-applications` | candidate | Candidate's own applications + statuses |
| GET/POST/PUT/DELETE | `/api/applications`, `/api/applications/:id`, `/api/applications/:id/:action` | staff | Application CRUD + status actions (re-analyze, review…) |
| GET/POST/PUT/DELETE | `/api/candidates`, `/api/candidates/:id` | staff | Candidate CRUD + profile detail |
| GET/POST/PUT/DELETE | `/api/departments`, `/api/departments/:id` | staff | Department CRUD |
| GET/POST/PUT/DELETE | `/api/offers`, `/api/offers/:id` | staff | Offer CRUD |
| GET/POST/PUT/DELETE | `/api/users`, `/api/users/:id` | admin | Staff/admin user management |
| GET | `/api/dashboard` | staff | KPIs + chart series (status, fields, monthly, skills, fill rates) |
| POST | `/api/matching-run` | staff | Launch scoring + Hungarian assignment run |
| GET | `/api/matching-runs` | staff | Past runs |
| GET | `/api/offer-rankings` | staff | Ranked candidates per offer with score breakdowns |
| GET/POST | `/api/assignments`, `/api/assignments/:id` | staff | Validate/reject proposed assignments |
| GET | `/api/capacity-forecast` | staff | XGBoost next-month demand forecast + slot recommendations |
| POST | `/api/assistant/query` | staff | RAG query (candidate search / score explanation / policy Q&A, FR+EN) |
| GET/POST | `/api/assistant/documents` | staff | List / upload (PDF/DOCX/TXT) knowledge documents |
| DELETE | `/api/assistant/documents/:name` | staff | Remove a knowledge document's chunks |

### FastAPI (`/api/v1/*`) — legacy stack
Same domain: `auth` (JWT login/refresh/me), `public`, `departments`, `offers`, `candidates`, `applications`, `matching`, `dashboard`, `planning` (`/planning/forecast`, `/capacity-forecast` alias), `assistant` (RAG query/documents).

---

## 10. Configuration & Environment

| File | Scope | Notes |
|---|---|---|
| `frontend/.env.example` | SPA | `VITE_API_URL=/api`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public by design) |
| Host env (Vercel/Netlify) | Functions | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (**secret — never `VITE_`**), `GROQ_API_KEY` (**secret**) |
| `.env.example` | Docker stack | Postgres/Redis/MinIO/JWT (`SECRET_KEY`), LLM provider keys, spaCy/embedding models, `FIRST_ADMIN_*` (seeder refuses default pwd when `ENVIRONMENT=production`) |
| `.env.supabase.example` | Docker stack on Supabase | Same, annotated (pooler URLs, checklist) |
| `frontend/src/config.ts` | SPA | `VITE_SHOW_CONSTELLATION` (background on by default) |
| `vercel.json` | Vercel | `vercel-build` = bundle api + build frontend; SPA rewrite excludes `/api/` |
| `netlify.toml` | Netlify | Node 22 required (native WebSocket for supabase-js); esbuild bundler; secrets-scanner omissions for public keys |
| `render.yaml` | Render | FastAPI + worker + beat + Redis blueprint |

---

## 11. Build, Run & Deployment

### Serverless (production path)
```bash
# Frontend dev
cd frontend && npm install && npm run dev          # http://localhost:5173
# Functions typecheck/tests
cd netlify/functions && npm install && npm run typecheck && npm test
# Full local serverless emulation
netlify dev
# Vercel production deploy (auto-deploy from GitHub is configured but currently unreliable)
npx vercel link --project pfa-v2 && npx vercel deploy --prod
```
Vercel build = `node scripts/bundle-api.mjs && npm --prefix frontend install && npm --prefix frontend run build`.
Supabase: apply `supabase/migrations/0001→0008` in the SQL editor; set function env vars.

### Docker stack (full legacy)
```bash
cp .env.example .env   # adjust SECRET_KEY, FIRST_ADMIN_PASSWORD
docker compose up -d   # db, redis, minio, backend, celery-worker, celery-beat, frontend
docker compose exec backend alembic upgrade head
```

### CI (`.github/workflows/ci.yml`)
Three parallel jobs on push/PR to `main`:
1. **Backend** — Python 3.11, `ruff check`, `black --check`, `pytest` (pythonpath fix in `pyproject.toml`).
2. **Frontend** — Node 22, `npm ci`, `npm run build` (runs `tsc -b` + vite).
3. **Functions** — Node 22, `npm ci`, `tsc --noEmit`, `vitest run`.
Branch protection setup documented in `docs/devops.md`.

---

## 12. Testing

| Suite | Framework | Location | Coverage focus |
|---|---|---|---|
| Backend (25 tests) | pytest | `backend/tests/` | Matching/scoring, Hungarian, forecast helpers, embedding cache, RAG router, API integration, cross-stack scoring parity |
| Functions | Vitest 2 | `netlify/functions/**/*.test.ts` | CV cache, RAG routing/retrieval, capacity forecast, XGBoost TS-vs-Python parity, scoring parity |
| Frontend | Vitest 3 + Testing Library (jsdom) | `frontend/src/components/__tests__/` | ErrorBoundary, KpiCard, ProtectedRoute |

Run: `pytest -q` (in `backend/`, venv), `npm test` (in `netlify/functions/` and `frontend/`). No coverage thresholds configured. The **parity fixtures** (`shared/fixtures/scoring-parity.json`, `forecast_model.json` expected values) are the most valuable tests — they pin the two stacks together.

---

## 13. Known Issues / TODOs

No `TODO`/`FIXME` comments exist in the source. Observed issues:

1. **Vercel auto-deploy from GitHub is unreliable** — several pushes to `main` produced no deployment; production had to be deployed manually (`vercel deploy --prod`). Fix in Vercel → Settings → Git.
2. **Broken alias** — `pfa-v2-ten.vercel.app` returns platform `NOT_FOUND` although the alias table maps it; use `pfa-v2-abdellahb9s-projects.vercel.app`.
3. **`api/_handler.cjs` is a committed build artifact** (~100k+ lines) — regenerated by `scripts/bundle-api.mjs`; easy to forget to rebuild, bloats diffs.
4. **Dependency duplication** — root and `netlify/functions` declare the same runtime deps; drift risk.
5. **Landing page placeholder copy** — "Texte placeholder" strings still visible in production (mission section, hero subtitle).
6. **Unused heavy Python deps** — `langchain`, `langchain-community`, `faiss-cpu` likely removable.
7. **Frontend bundle size** — main chunk ~1.4 MB minified (antd + recharts); code-splitting beyond route-level lazy() not configured.
8. **`backend/celerybeat-schedule` committed** — runtime artifact that should be gitignored.
9. **`nvidia-models-clone/` in the same repo** — unrelated project; consider extracting.
10. **Supabase advisor warning** — Leaked Password Protection disabled (optional auth hardening).
11. **`docs/rapport-projet.md` deleted locally but still tracked** — resolve (restore or `git rm`).

---

## 14. Suggestions for Improvement

**Architecture**
- Make `netlify/functions/_shared` a real npm workspace consumed by both Netlify and the Vercel bundle to remove the dual `package.json` duplication.
- Generate `api/_handler.cjs` in CI/at build only (add to `.gitignore`); the Vercel build already runs `bundle-api.mjs`.
- Extract `nvidia-models-clone/` to its own repository.

**Security**
- Enable Supabase Leaked Password Protection and consider MFA for staff.
- Add rate limiting on the serverless public endpoints beyond `submit-application` (e.g. `assistant/query` per-user quotas — each call costs Groq tokens).
- Rotate the Groq/Supabase service keys periodically; keys currently live only in host env (good) — document rotation in `docs/devops.md`.
- Pin exact versions (remove `^`) in the functions `package.json` for reproducible serverless builds.

**Performance**
- Split the frontend main chunk (`manualChunks` for antd/recharts) — LCP on slow connections will improve markedly.
- Add HTTP cache headers to `dashboard`/`public-offers` responses (short s-maxage) — they are hit on every page load.
- Batch Supabase queries in `dashboard.ts` (single RPC instead of N selects) if latency grows with data.

**Code quality / process**
- Fix the GitHub↔Vercel integration so `main` deploys automatically; until then document `vercel deploy --prod` in `DEPLOYMENT.md`.
- Add ESLint to CI for the frontend (job currently only builds) and Prettier config repo-wide.
- Add coverage reporting (c8/vitest --coverage, pytest-cov) with a modest threshold to protect the parity suites.
- Replace the landing-page placeholder copy before showing the site to stakeholders.
- Align vitest major versions between `frontend` and `netlify/functions`.
