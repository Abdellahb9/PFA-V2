# DevOps — CI & Protection de branche

## Pipeline CI (`.github/workflows/ci.yml`)

Se déclenche sur **pull request** vers `main` et sur **push** vers `main`.
Trois jobs (échec ⇒ merge bloqué) :

| Job | Ce qu'il fait |
|---|---|
| **backend** | `ruff check .` · `black --check .` · `pytest -q` (unités + intégration API sur SQLite en mémoire, Python 3.11) |
| **frontend** | `npm ci` · `vitest run` (Testing Library, jsdom) · `npm run build` (exécute `tsc -b` puis `vite build`) |
| **functions** | `npm ci` · `tsc --noEmit` · `vitest run` (tests serverless, dont parité de scoring avec le backend) |

> ⚠️ **Avant le premier passage** : le repo n'a peut-être jamais été formaté par
> `black`/`ruff`. Lance une fois `cd backend && black . && ruff check --fix .`,
> commit le résultat, sinon le job `backend` échouera sur le formatage existant.

## Protection de branche `main` (à appliquer dans GitHub)

**Settings → Branches → Add branch ruleset (ou Add rule)** pour `main` :

- ✅ **Require a pull request before merging**
  - Require approvals : **1**
  - Dismiss stale approvals on new commits
- ✅ **Require status checks to pass before merging**
  - Require branches to be up to date before merging
  - Status checks requis (à sélectionner après le 1ᵉʳ run CI) :
    - `Backend (ruff · black · pytest)`
    - `Frontend (tsc · build)`
    - `Serverless functions (tsc · vitest)`
- ✅ **Require conversation resolution before merging**
- ✅ **Do not allow bypassing the above settings** (inclut les administrateurs)
- ✅ **Restrict who can push to matching branches** → personne en direct
  (⇒ **plus de push direct** sur `main`, tout passe par PR)
- ❌ Allow force pushes / deletions : **désactivés**

### Résultat
- Aucun **push direct** sur `main`.
- Toute modif passe par **PR + revue (1) + CI verte**.
- Le merge est **bloqué** tant qu'un des 3 jobs échoue.

> Note : les status checks n'apparaissent dans la liste qu'**après** que le CI a
> tourné au moins une fois (ouvre une PR de test pour les faire apparaître).
