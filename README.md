# Assistant IA — Gestion des stages & affectation intelligente · OCP PHOSBOUCRAA

Assistant intelligent qui automatise la **réception des demandes de stage**, le
**profilage NLP des candidats** (CV / lettres), l'évaluation des **besoins et
capacités des départements**, et propose une **affectation optimale**
stagiaire → service grâce à l'**algorithme Hongrois**. Une **landing page publique**
présente la Fondation et ses offres ; l'espace d'administration est protégé par JWT.

> Projet de fin d'études — PHOSBOUCRAA S.A. (Groupe OCP), Laâyoune.
> Interface utilisateur en **français**, code et commentaires en **anglais**.

---

## 🏗️ Architecture

Architecture en couches (MVC étendu + couche services IA) :

```
[ React / TypeScript / Ant Design ]
              │  REST (JWT)
              ▼
[ FastAPI ]  ──►  [ Services IA + Celery workers ]
              │                    │
              ▼                    ▼
[ PostgreSQL + pgvector ]   [ Redis ]   [ MinIO (S3) ]
   (Supabase en prod)
```

6 modules métier : **Ingestion/Parsing**, **NLP profilage**, **Besoins/Capacités**,
**Moteur d'affectation (Hongrois)**, **Dashboard admin**, **Notifications**.

---

## 🧰 Stack technologique

| Couche      | Technologies |
|-------------|--------------|
| Frontend    | React 18, TypeScript, Vite, Redux Toolkit, Ant Design, Recharts, React Query, React Hook Form + Zod |
| Backend     | FastAPI, Python 3.11, SQLAlchemy 2 + Alembic, Pydantic v2, JWT/OAuth2 (bcrypt), Celery + Redis |
| IA / NLP    | spaCy (fr/en), Sentence-Transformers, FAISS, scikit-learn, LangChain (OpenAI/Mistral, optionnel), PyMuPDF/pdfplumber, **scipy (algorithme Hongrois)** |
| Données     | PostgreSQL + **pgvector** (**Supabase** en prod), Redis, MinIO |
| DevOps      | Docker, Docker Compose, Nginx |

---

## 📁 Structure du projet

```
PFA/
├── docker-compose.yml          # Orchestration de tous les services
├── .env.example                # Variables d'environnement (dont Supabase)
├── nginx/nginx.conf            # Reverse proxy (gateway optionnelle)
├── backend/
│   ├── Dockerfile · requirements.txt · alembic.ini
│   ├── alembic/versions/       # 0001_initial_schema · 0002_enable_rls · 0003_index_foreign_keys
│   └── app/
│       ├── main.py             # Point d'entrée FastAPI (+ seed au démarrage)
│       ├── core/               # config, database, security (bcrypt/JWT), celery_app
│       ├── models/             # 12 modèles SQLAlchemy + colonnes pgvector
│       ├── schemas/            # Schémas Pydantic v2
│       ├── api/v1/             # auth, public, departments, offers, candidates,
│       │                       #   applications, matching, dashboard
│       ├── services/
│       │   ├── nlp/            # parser, skills_db, pipeline, embeddings, llm
│       │   ├── matching/       # scoring + hungarian + service (BDD↔moteur)
│       │   └── storage.py      # MinIO (upload / download / delete)
│       ├── tasks/              # Celery : cv_analysis, matching_tasks, notifications
│       └── crud/               # seed (admin + données démo), skill helpers
└── frontend/
    ├── Dockerfile · nginx.conf · vite.config.ts · package.json
    └── src/
        ├── assets/             # phosboucraa-logo.png (placeholder à remplacer)
        ├── api/                # client Axios + types + hooks React Query
        ├── store/              # Redux Toolkit (auth)
        ├── components/         # Layout, ProtectedRoute, KpiCard, FadeIn, AppLoader,
        │                       #   RouteFallback, ErrorBoundary, SkeletonTable,
        │                       #   NewApplicationModal, DepartmentFormModal
        └── pages/              # Landing (publique), Login, Dashboard, Candidatures,
                                #   Candidats, Départements, Offres, Matching
```

---

## 🚀 Démarrage rapide (Docker)

Prérequis : **Docker** et **Docker Compose**.

```bash
# 1. Configurer l'environnement
cp .env.example .env
#   éditez .env : SECRET_KEY (openssl rand -hex 32), DATABASE_URL, clés LLM optionnelles

# 2. Construire et lancer tous les services
docker compose up --build
```

Au démarrage, le backend applique les migrations Alembic puis **amorce la base**
(admin + départements/offres/candidats de démonstration).

| Service            | URL                                |
|--------------------|------------------------------------|
| Landing publique   | http://localhost:3000              |
| Espace admin       | http://localhost:3000/login        |
| API (Swagger)      | http://localhost:8000/docs         |
| API (ReDoc)        | http://localhost:8000/redoc        |
| Console MinIO      | http://localhost:9001              |

**Identifiants admin par défaut** (modifiables dans `.env`) :
`admin@phosboucraa.ma` / `Admin@1234`

---

## 🗄️ Base de données — local ou Supabase

Par défaut, `docker compose` lance un **Postgres + pgvector** local. Pour utiliser
**Supabase** à la place, pointez `DATABASE_URL` dans `.env` vers votre projet :

```env
# Session Pooler (IPv4, recommandé depuis Docker — supporte les prepared statements)
DATABASE_URL=postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

- ⚠️ La **connexion directe** `db.<ref>.supabase.co` est **IPv6-only** → souvent
  inatteignable depuis Docker Desktop (Windows). Utilisez le **Session Pooler** (IPv4).
- **URL-encodez** les caractères spéciaux du mot de passe (`,`→`%2C`, `$`→`%24`, `%`→`%25`…).
- Activez l'extension **`vector`** (Database → Extensions).
- Pooler **transactionnel** (port 6543) → ajoutez `DB_DISABLE_PREPARED_STATEMENTS=true`.
- **Sécurité (RLS)** : la migration `0002_enable_rls` active la **Row Level Security**
  (deny-by-default, aucune policy) sur toutes les tables → l'API PostgREST publique de
  Supabase (`anon`) est bloquée, tandis que le backend (rôle `postgres`, propriétaire +
  `BYPASSRLS`) fonctionne normalement.

---

## ☁️ Déploiement en production (Netlify + backend séparé)

> **Netlify héberge uniquement le frontend statique.** Le backend (FastAPI +
> Celery + Redis + MinIO) doit tourner sur un hébergeur de services
> (Render / Railway / Fly.io / VPS). La base est déjà sur **Supabase**.

### 1. Frontend → Netlify
Config dans [`netlify.toml`](netlify.toml) (racine) :
- `base = "frontend"`, `command = "npm run build"`, `publish = "dist"` ;
- **fallback SPA** (`/* → /index.html`) pour React Router ;
- **proxy** `/api/* → https://YOUR-BACKEND-DOMAIN/api/:splat` → le frontend appelle
  un chemin **relatif** `/api/v1` (même origine, **pas de CORS**).

Étapes : connecter le repo à Netlify (il détecte `netlify.toml`) → remplacer
`YOUR-BACKEND-DOMAIN` par l'URL publique du backend → déployer. **Aucun Docker**
n'est nécessaire pour le frontend.

### 2. Backend → Render (Blueprint fourni)
Un **Render Blueprint** est fourni : [`render.yaml`](render.yaml). Il provisionne
depuis le `Dockerfile` existant :
- **`phosboucraa-api`** (web) — applique les migrations puis lance uvicorn sur `$PORT` ;
- **`phosboucraa-worker`** (Celery worker) ;
- **`phosboucraa-beat`** (Celery beat — matching nocturne) ;
- **`phosboucraa-redis`** (Redis managé, broker + backend Celery).

Déploiement : Render → **New → Blueprint** → connecter ce repo → renseigner dans le
dashboard les variables `sync: false` :
- **`DATABASE_URL`** → Supabase (Session Pooler, mot de passe URL-encodé) ;
- **`MINIO_ENDPOINT` / `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`** → stockage objet
  **S3-compatible** (AWS S3, **Supabase Storage**, ou une instance MinIO) — Render
  n'héberge pas MinIO ;
- (optionnel) clés LLM, et `CORS_ORIGINS` si appel direct sans proxy.

> Plan **standard** recommandé pour l'API et le worker (la pile NLP — torch + spaCy +
> embeddings — nécessite ~2 Go de RAM). Le build d'image est long (~15-25 min, modèles inclus).

Enfin, dans `netlify.toml`, le proxy pointe par défaut vers
`https://phosboucraa-api.onrender.com` — ajustez si votre nom de service diffère.

### Variante sans proxy (appel direct)
Définir `VITE_API_URL=https://YOUR-BACKEND-DOMAIN/api/v1` dans Netlify et **ajouter le
domaine Netlify à `CORS_ORIGINS`** côté backend. Recommandé si l'upload de CV approche
la limite de taille des rewrites Netlify.

---

## 🧭 Routes (frontend)

| Route | Accès | Page |
|-------|-------|------|
| `/` | **public** | Landing « Phosboucraa Foundation » (présentation + offres publiques) |
| `/login` | public | Connexion (espace admin) |
| `/dashboard` | protégé | Tableau de bord (KPIs + graphiques) |
| `/candidatures` | protégé | Candidatures (upload CV, statut live, suppression) |
| `/candidats` | protégé | Candidats profilés |
| `/departements` | protégé | Départements (création / modification / suppression) |
| `/offres` | protégé | Offres de stage (CRUD) |
| `/matching` | protégé | Moteur d'affectation (Hongrois) |

---

## 🔌 Principaux endpoints API

| Méthode | Endpoint | Auth | Description |
|---------|----------|:----:|-------------|
| `GET`   | `/api/v1/public/offers` | — | **Offres ouvertes (public, landing)** |
| `POST`  | `/api/v1/auth/login` | — | Connexion (OAuth2, renvoie JWT) |
| `POST`  | `/api/v1/applications` | — | Soumettre une candidature + CV (déclenche l'analyse NLP) |
| `GET`   | `/api/v1/applications/{id}/documents/{doc}/download` | ✓ | Télécharger / prévisualiser un CV |
| `DELETE`| `/api/v1/applications/{id}` | ✓ | Supprimer une candidature (cascade docs + MinIO) |
| `GET`   | `/api/v1/candidates` | ✓ | Liste des candidats profilés |
| `POST` `PATCH` `DELETE` | `/api/v1/departments[/{id}]` | ✓ | CRUD département (suppression bloquée si offres) |
| `POST` `PATCH` `DELETE` | `/api/v1/offers[/{id}]` | ✓ | CRUD offre (suppression bloquée si candidatures) |
| `POST`  | `/api/v1/matching/run` | ✓ | Optimisation Hongroise (aperçu ou enregistrement) |
| `PATCH` | `/api/v1/matching/assignments/{id}` | ✓ | Confirmer / rejeter une affectation |
| `GET`   | `/api/v1/dashboard` | ✓ | KPIs + séries pour les graphiques |

> Intégrité référentielle : *bloquer les parents, supprimer les feuilles* — un département
> avec offres ou une offre avec candidatures renvoie **409** avec un message clair.

---

## 🧠 Comment fonctionne le matching

1. **Profilage** — chaque CV est parsé (PyMuPDF/OCR), analysé par spaCy + un
   gazetteer de compétences (et, si une clé est fournie, un LLM via LangChain),
   puis encodé en vecteur sémantique (Sentence-Transformers, stocké dans pgvector).
   L'université est détectée par regex (ENSA, FST, Faculté…) et un **score d'adéquation**
   indicatif est calculé dès la fin de l'analyse.
2. **Score composite** par paire (candidat, offre), dans `[0, 1]` :
   `0.5·similarité_sémantique + 0.35·adéquation_compétences + 0.15·niveau_études`
   (pondérations ajustables depuis l'UI).
3. **Optimisation globale** — les offres sont dépliées en *slots* (capacité), une
   matrice de coût `1 − score` est résolue par
   `scipy.optimize.linear_sum_assignment` (**algorithme Hongrois**) afin de
   **maximiser le score total** d'affectation.
4. Les affectations proposées sont **explicables** (détail du score) et
   validables par un recruteur. Un job Celery beat relance l'optimisation chaque nuit.

---

## 🎛️ Fonctionnalités UI notables

- **Landing publique** responsive (charte Foundation `#3DBB5E`) avec offres en lecture seule.
- **Upload de CV** (PDF/DOCX) → analyse Celery → statut *live* (polling) → compétences/score.
- **Système de chargement** soigné : splash d'app accessible (`AppLoader`), fallback de route
  (`Suspense` + lazy-loading), **skeletons AntD** sur les tables (sans saut de mise en page),
  fade-in, `ErrorBoundary` (auto-récupération des chunks périmés).
- **CRUD** complet départements/offres + suppression de candidatures, avec confirmations.

---

## 🧪 Tests & qualité

```bash
cd backend && pytest            # tests du moteur de scoring/Hongrois
ruff check . && black .         # lint + format Python
cd frontend && npm run build    # tsc (strict) + build Vite
```

---

## 🔐 Notes de configuration

- **LLM optionnel** : sans `OPENAI_API_KEY`/`MISTRAL_API_KEY`, le pipeline
  fonctionne intégralement avec spaCy + le gazetteer (aucun appel externe).
- **OCR optionnel** : les PDF scannés passent par Tesseract si `pytesseract` est installé.
- **Sécurité** : changez impérativement `SECRET_KEY` et les mots de passe par défaut ;
  la RLS est activée côté base (migration `0002`).
- **Logo** : remplacez `frontend/src/assets/phosboucraa-logo.png` (placeholder) par le
  logo officiel (même nom → aucun changement de code), puis rebuild le frontend.
```
docker compose up -d --build frontend
```
