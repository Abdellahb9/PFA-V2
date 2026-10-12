# Assistant IA — Gestion des stages & affectation intelligente · OCP PHOSBOUCRAA

Application qui automatise la **réception des candidatures de stage**, l'**analyse
des CV** (extraction structurée par LLM), l'évaluation des **besoins et capacités
des départements**, et propose une **affectation optimale** stagiaire → offre grâce
à l'**algorithme Hongrois**. Un **assistant IA** répond aux recruteurs sur les
candidats, leurs CV, leurs candidatures et les offres. Une **landing page
publique** présente la Fondation et ses offres ; un **portail candidat** permet de
postuler et de suivre sa candidature.

> Projet de fin d'études — PHOSBOUCRAA S.A. (Groupe OCP), Laâyoune.
> Interface utilisateur en **français**.

---

## 🏗️ Architecture

Tout tourne sur **Vercel** (aucun serveur à maintenir) :

```
[ Vercel ]    frontend/ (React, statique)  +  api/[...path].ts → server/ (une fonction Node)
[ Supabase ]  Postgres (schéma + RLS + pgvector) · Storage (CV) · Auth (staff & candidats)
[ Groq ]      LLM gpt-oss — extraction des CV, assistant
[ Gemini ]    gemini-embedding-2 — vecteurs de la base de connaissances (optionnel)
```

---

## 🧰 Stack technologique

| Couche | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite, Redux Toolkit, Ant Design, Recharts, React Query |
| API | Fonctions Vercel (Node, Web `Request`/`Response`), TypeScript, Zod, bundlé par esbuild |
| Données | Supabase : Postgres + `pgvector` + `pg_trgm`, Storage, Auth |
| IA | Groq (`openai/gpt-oss-120b` pour l'assistant, `gpt-oss-20b` pour l'extraction des CV), Google `gemini-embedding-2` (vecteurs), `unpdf` / `mammoth` pour le texte |
| Tests | Vitest (API, avec PGlite pour exécuter les vraies migrations), Vitest + Testing Library (frontend) |

---

## 📁 Structure du projet

```
PFA/
├── api/[...path].ts        # Point d'entrée Vercel : charge api/_handler.cjs (généré)
├── server/                 # Toute l'API
│   ├── handler.ts          #   routeur (chemin → route)
│   ├── routes/             #   une route par fichier (offers, applications, assistant…)
│   ├── lib/                #   auth, Supabase, scoring, Hongrois, CV, RAG (lib/rag/)…
│   └── scripts/            #   évaluation de l'assistant, démonstration RAG
├── supabase/migrations/    # Schéma SQL, à appliquer dans l'ordre (0001 → …)
├── frontend/               # Application React (Vite)
├── scripts/
│   ├── bundle-api.mjs      # server/handler.ts → api/_handler.cjs (au build Vercel)
│   └── train_forecast.py   # Outil hors ligne : entraîne server/lib/forecast_model.json
├── vercel.json             # Build, réécritures, durée des fonctions
└── vitest.config.ts        # Tests de l'API (server/**/*.test.ts)
```

---

## 🚀 Développement local

Prérequis : Node 22+, un projet Supabase (voir [DEPLOYMENT.md](DEPLOYMENT.md)).

```bash
npm install                     # dépendances de l'API et des outils
npm --prefix frontend install   # dépendances du frontend
cp .env.example .env            # puis renseignez les clés
npm --prefix frontend run dev   # http://localhost:5173
```

Pour exécuter aussi l'API en local : `npm run bundle-api` (génère
`api/_handler.cjs`) puis `npx vercel dev` (après `npx vercel login` et
`npx vercel link`).

---

## 🧭 Routes (frontend)

| Route | Accès | Page |
|---|---|---|
| `/` | public | Landing « Phosboucraa Foundation » (présentation + offres) |
| `/login`, `/inscription` | public | Connexion, inscription candidat |
| `/mon-espace` | candidat | Suivi de ses candidatures, demande d'échange d'offre |
| `/dashboard` | staff | Tableau de bord (KPIs + graphiques) |
| `/candidatures`, `/candidats` | staff | Candidatures (upload CV, statut, réanalyse), candidats profilés |
| `/departements`, `/offres` | staff | CRUD départements et offres |
| `/matching` | staff | Moteur d'affectation (Hongrois) |
| `/assistant` | staff | Assistant IA et base de connaissances |
| `/reservations`, `/demandes-echange` | staff | Places réservées, demandes d'échange d'offre |
| `/utilisateurs` | admin | Comptes staff |

L'API est servie sous `/api/*` ; la liste complète des routes est dans
[`server/handler.ts`](server/handler.ts).

---

## 🧠 Comment fonctionne le matching

1. **Profilage** — chaque CV est lu (`unpdf` / `mammoth`) puis analysé par Groq
   (extraction JSON, mise en cache par empreinte du texte) : formation, niveau,
   université, expérience, compétences normalisées.
2. **Score composite** par paire (candidat, offre), dans `[0, 1]` :
   `0.7 · couverture des compétences + 0.3 · adéquation du niveau d'études`
   (`server/lib/scoring.ts`).
3. **Optimisation globale** — les offres sont dépliées en places, la matrice de coût
   `1 − score` est résolue par l'**algorithme Hongrois** (`server/lib/hungarian.ts`)
   pour maximiser le score total.
4. Les affectations proposées sont **explicables** (détail du score) et validées par
   un recruteur.

---

## 🧪 Tests & qualité

```bash
npm test                         # API : unités + SQL réel sur PGlite (migrations rejouées)
npm run typecheck                # API : tsc strict
npm --prefix frontend test       # frontend : Vitest + Testing Library
npm --prefix frontend run build  # frontend : tsc + build Vite
npm run eval:rag                 # assistant : évaluation de bout en bout (Groq réel, lit .env)
```

La CI (`.github/workflows/ci.yml`) exécute les quatre premières commandes.

---

## 🔐 Notes de configuration

- Variables d'environnement : [`.env.example`](.env.example) et
  [DEPLOYMENT.md](DEPLOYMENT.md#1-variables-denvironnement).
- Les variables `VITE_*` sont publiques (intégrées au bundle client) : n'y mettez
  jamais de clé secrète.
- La RLS est activée sur toutes les tables ; l'API utilise la clé `service_role`
  et contrôle elle-même le rôle de l'appelant (`server/lib/auth.ts`).
