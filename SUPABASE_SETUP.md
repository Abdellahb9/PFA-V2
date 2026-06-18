# Guide de connexion à Supabase

Ce guide vous explique comment configurer votre application pour utiliser Supabase au lieu d'une base de données PostgreSQL locale.

## 📋 Prérequis

- Un compte Supabase (créez-en un sur [supabase.com](https://supabase.com))
- Un projet Supabase actif

---

## 🔧 Étape 1 : Créer un projet Supabase

1. Connectez-vous à [supabase.com](https://supabase.com)
2. Cliquez sur **"New Project"**
3. Remplissez les informations :
   - **Nom du projet** : `phosboucraa-assistant-ia` (ou autre)
   - **Database Password** : Choisissez un mot de passe fort (notez-le !)
   - **Region** : Choisissez la région la plus proche (ex: `eu-west-1` pour l'Europe)
   - **Pricing Plan** : Free tier suffit pour commencer
4. Cliquez sur **"Create new project"**
5. Attendez ~2 minutes que le projet soit provisionné

---

## 🔌 Étape 2 : Activer les extensions PostgreSQL

Supabase utilise PostgreSQL, mais vous devez activer les extensions requises :

1. Dans votre projet Supabase, allez dans **Database** → **Extensions** (menu de gauche)
2. Recherchez et activez ces extensions :
   - **`vector`** (pgvector) - **OBLIGATOIRE** pour les embeddings sémantiques
   - **`uuid-ossp`** - **OBLIGATOIRE** pour la génération d'UUID

> ⚠️ **Important** : L'extension s'appelle `vector` dans Supabase (pas `pgvector`)

### Méthode alternative (SQL Editor)

Vous pouvez aussi exécuter ce SQL dans **SQL Editor** :

```sql
-- Activer les extensions requises
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

---

## 🔑 Étape 3 : Récupérer la chaîne de connexion

1. Allez dans **Settings** → **Database** (icône engrenage en bas à gauche)
2. Faites défiler jusqu'à **Connection String**
3. Sélectionnez **"URI"** (pas "Connection pooling")
4. Copiez la chaîne qui ressemble à :
   ```
   postgresql://postgres.xxxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
   ```

### ⚠️ Modifier la chaîne de connexion pour SQLAlchemy

SQLAlchemy utilise le driver `psycopg` (version 3). Vous devez modifier la chaîne :

**AVANT** (format Supabase par défaut) :
```
postgresql://postgres.xxxxx:[PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

**APRÈS** (format compatible SQLAlchemy + psycopg 3) :
```
postgresql+psycopg://postgres.xxxxx:[PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

> 📝 **Notez** : Ajoutez `+psycopg` après `postgresql://`

---

## ⚙️ Étape 4 : Configurer le fichier .env

Modifiez votre fichier `.env` à la racine du projet :

```bash
# --- PostgreSQL / Supabase -------------------------------------------------
# Ces variables ne sont plus utilisées avec Supabase (mais gardez-les pour Docker local si besoin)
POSTGRES_USER=phosboucraa
POSTGRES_PASSWORD=phosboucraa
POSTGRES_DB=phosboucraa

# IMPORTANT : Remplacez par votre connexion Supabase
DATABASE_URL=postgresql+psycopg://postgres.xxxxxxxxxxxxx:[VOTRE-MOT-DE-PASSE]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

### 🔐 Exemple complet avec mot de passe

Si votre mot de passe Supabase est `MyS3cur3P@ss`, votre `DATABASE_URL` sera :

```bash
DATABASE_URL=postgresql+psycopg://postgres.abcdefghijklmn:MyS3cur3P@ss@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

> ⚠️ **Attention** : Si votre mot de passe contient des caractères spéciaux (`@`, `#`, `%`, etc.), vous devez les encoder en URL :
> - `@` → `%40`
> - `#` → `%23`
> - `%` → `%25`

---

## 🐳 Étape 5 : Adapter Docker Compose (optionnel)

Si vous voulez utiliser Supabase **sans** le conteneur PostgreSQL local :

### Option A : Démarrer uniquement les services nécessaires

```bash
# Ne démarrez PAS le service 'db'
docker-compose up -d redis minio minio-init backend celery-worker celery-beat frontend
```

### Option B : Modifier docker-compose.yml

Commentez ou supprimez la dépendance `db` dans les services :

```yaml
backend:
  # ...
  depends_on:
    # db:                      # ← Commentez cette ligne
    #   condition: service_healthy
    redis:
      condition: service_healthy
    minio:
      condition: service_healthy
```

Et dans les variables d'environnement du backend, supprimez la surcharge :

```yaml
backend:
  env_file:
    - .env
  # Supprimez ou commentez cette ligne :
  # environment:
  #   DATABASE_URL: postgresql+psycopg://...@db:5432/...
```

---

## 🚀 Étape 6 : Démarrer l'application

### Avec Docker (recommandé)

```bash
# Si vous utilisez Supabase + les autres services en local
docker-compose up -d redis minio minio-init backend celery-worker celery-beat frontend

# Ou avec Docker local complet (si vous voulez garder l'option locale)
docker-compose up -d
```

### Sans Docker (développement local)

```bash
cd backend

# Installer les dépendances
pip install -r requirements.txt

# Appliquer les migrations sur Supabase
alembic upgrade head

# Démarrer l'application
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Le backend va :
1. Se connecter à Supabase
2. Créer toutes les tables (via Alembic)
3. Initialiser les données de démonstration (admin, départements, offres, candidats)

---

## ✅ Vérification

### 1. Vérifier la connexion dans Supabase

Allez dans **Table Editor** dans votre projet Supabase. Vous devriez voir ces tables :

- `users`
- `departments`
- `offers`
- `candidates`
- `applications`
- `assignments`
- `matching_runs`
- `notifications`
- `skills`
- `documents`

### 2. Tester l'API

```bash
# Vérifier que l'API fonctionne
curl http://localhost:8000/api/v1/health

# Se connecter avec le compte admin
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@phosboucraa.ma&password=Admin@1234"
```

### 3. Accéder à l'interface

Ouvrez http://localhost:3000 et connectez-vous avec :
- **Email** : `admin@phosboucraa.ma`
- **Mot de passe** : `Admin@1234`

---

## 🔥 Supabase vs PostgreSQL local : Comparaison

| Aspect | PostgreSQL local (Docker) | Supabase |
|--------|---------------------------|----------|
| **Setup** | Automatique via Docker Compose | Nécessite création de compte + projet |
| **Extensions** | Auto-installées via `init_db.sql` | Activation manuelle dans l'UI |
| **Hébergement** | Local (votre machine) | Cloud (géré par Supabase) |
| **Performance** | Dépend de votre machine | Stable, mais latence réseau |
| **Données** | Perdues si le conteneur est supprimé (sauf volume) | Persistantes dans le cloud |
| **Coût** | Gratuit (ressources locales) | Free tier : 500 MB, puis payant |
| **Accès distant** | Non (sauf config réseau) | Oui (accessible partout) |
| **Backup** | Manuel | Automatique (dans les plans payants) |
| **Production** | ❌ Non recommandé | ✅ Recommandé |

---

## 🛠️ Dépannage

### Erreur : "could not connect to server"

- Vérifiez que votre `DATABASE_URL` est correcte
- Vérifiez que votre mot de passe est correctement encodé
- Vérifiez votre connexion internet

### Erreur : "extension 'vector' does not exist"

- Allez dans Database → Extensions dans Supabase
- Activez l'extension `vector`

### Erreur : "SSL connection required"

Ajoutez `?sslmode=require` à la fin de votre `DATABASE_URL` :

```bash
DATABASE_URL=postgresql+psycopg://...postgres?sslmode=require
```

### Les migrations ne s'appliquent pas

```bash
# Forcer la réinitialisation (⚠️ ATTENTION : supprime toutes les données)
alembic downgrade base
alembic upgrade head
```

---

## 📚 Ressources

- [Documentation Supabase](https://supabase.com/docs)
- [Supabase pgvector Guide](https://supabase.com/docs/guides/database/extensions/pgvector)
- [SQLAlchemy + Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres#connecting-with-sqlalchemy)

---

## 💡 Conseils pour la production

1. **Sécurité** :
   - Changez `SECRET_KEY` dans `.env`
   - Changez le mot de passe admin (`FIRST_ADMIN_PASSWORD`)
   - Activez Row Level Security (RLS) dans Supabase si nécessaire

2. **Performance** :
   - Utilisez Connection Pooling (`pgbouncer`) fourni par Supabase
   - Activez les index sur les colonnes fréquemment requêtées

3. **Monitoring** :
   - Utilisez le dashboard Supabase pour surveiller les requêtes
   - Configurez des alertes pour les dépassements de quota

4. **Backup** :
   - Configurez des sauvegardes automatiques (plans payants)
   - Exportez régulièrement vos données critiques

---

✅ **Vous êtes maintenant prêt à utiliser Supabase avec votre application !**
