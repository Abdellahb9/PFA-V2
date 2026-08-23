# Test manuel — Échange d'offre

Fonctionnalité : un candidat déjà affecté demande à changer d'offre en joignant
une preuve d'accord ; le personnel approuve ou refuse depuis `/demandes-echange`.

## 0. Prérequis — appliquer la migration

Ouvrir **Supabase → SQL Editor**, coller le contenu de
`supabase/migrations/0012_offer_switch_requests.sql`, exécuter.

Le script est idempotent (`if not exists`, `create or replace`) : le relancer ne
casse rien. Vérification rapide :

```sql
select table_name from information_schema.tables
where table_name in ('offer_switch_requests', 'notifications');

select proname from pg_proc where proname = 'approve_offer_switch';
```

Les deux tables doivent apparaître, ainsi que la fonction. Contrôler aussi que
RLS est bien actif et **sans policy** (l'accès passe uniquement par les
fonctions serverless, qui utilisent la clé service role) :

```sql
select relname, relrowsecurity from pg_class
where relname in ('offer_switch_requests', 'notifications');
-- relrowsecurity = true pour les deux

select count(*) from pg_policies
where tablename in ('offer_switch_requests', 'notifications');
-- 0
```

## 1. Préparer un jeu de données

Il faut un candidat avec une **affectation confirmée** et une **offre cible
ouverte ayant au moins une place libre**.

```sql
-- Qui est affecté à quoi (l'offre courante vient de assignments, pas de applications) ?
select a.id, a.application_id, a.candidate_id, a.offer_id, o.title, a.status
from assignments a join internship_offers o on o.id = a.offer_id
where a.status = 'confirmed';

-- Places restantes par offre (occupation dérivée : slots n'est jamais décrémenté)
select o.id, o.title, o.status, o.slots,
       count(a.id) filter (where a.status = 'confirmed') as occupees
from internship_offers o
left join assignments a on a.offer_id = o.id
group by o.id order by o.id;
```

Noter l'e-mail du candidat confirmé (table `candidates`) — c'est avec ce compte
qu'on se connecte à l'étape 2.

## 2. Côté candidat — déposer une demande

1. Se connecter avec le compte candidat, aller sur `/mon-espace`.
2. Le bloc **« Échanger mon offre de stage »** apparaît sous les candidatures et
   affiche l'offre actuelle. *(S'il n'apparaît pas, c'est qu'il n'y a pas
   d'affectation confirmée — revoir l'étape 1.)*
3. Cliquer **Demander un échange**, choisir une offre cible, joindre une image
   (JPG/PNG/WEBP, < 5 Mo), envoyer.
4. Attendu : message « Demande envoyée… », la demande s'affiche en **En
   attente**, et le bouton **Demander un échange** devient inactif.

Cas d'erreur à vérifier :

| Action | Attendu |
| --- | --- |
| Redemander un échange sans que le premier soit traité | « Vous avez déjà une demande en attente. » (l'index unique partiel) |
| Choisir une offre complète | « L'offre « X » est complète (n/m places). » |
| Envoyer un PDF au lieu d'une image | Refusé à l'upload (« Format non supporté : JPG, PNG ou WEBP uniquement ») |
| Se connecter avec un compte sans affectation confirmée | Le bloc n'apparaît pas |

## 3. Côté personnel — la notification

1. Se connecter en admin (ou recruteur).
2. La **cloche** en haut à droite porte une pastille et liste « Nouvelle demande
   d'échange d'offre ». Cliquer dessus mène à `/demandes-echange`.
3. L'entrée de menu **« Demandes d'échange »** porte elle aussi le nombre de
   demandes en attente.
4. Rouvrir la cloche : les notifications sont marquées lues (pastille à zéro).

## 4. Refus

1. Sur `/demandes-echange`, filtre **En attente**, cliquer **Refuser**.
2. Saisir un motif (facultatif), confirmer.
3. Attendu : la demande passe en **Refusée**, motif visible.
4. Côté candidat, `/mon-espace` montre la demande refusée avec le motif, et le
   bouton **Demander un échange** redevient actif.

## 5. Approbation — le cœur du test

Avant d'approuver, relever l'état :

```sql
select a.id, a.application_id, a.offer_id, a.match_score, a.status
from assignments a where a.application_id = <APPLICATION_ID>;

select id, offer_id from applications where id = <APPLICATION_ID>;
```

Approuver depuis l'interface (bouton **Approuver**, puis confirmation).

Attendu : « Échange effectué. » Puis vérifier que **tout** a bougé, en une seule
transaction :

```sql
-- 1. L'affectation confirmée pointe sur la nouvelle offre, score recalculé
select offer_id, match_score, decided_by from assignments
where application_id = <APPLICATION_ID> and status = 'confirmed';

-- 2. La candidature suit
select offer_id from applications where id = <APPLICATION_ID>;

-- 3. La demande est archivée avec son auteur
select status, reviewed_by, reviewed_at from offer_switch_requests
where id = '<REQUEST_ID>';

-- 4. Le candidat est notifié
select type, title, body from notifications
where type = 'offer_switch_approved' order by created_at desc limit 1;

-- 5. Trace dans l'historique de la candidature
select status, note from application_events
where application_id = <APPLICATION_ID> order by id desc limit 1;
```

Vérifier ensuite dans l'interface que **Candidatures**, **Offres réservées** et
le **Tableau de bord** montrent la nouvelle offre (les caches React Query sont
invalidés à l'approbation).

## 6. Concurrence — le garde-fou

Le cas qui justifie la RPC : deux demandes visant la **dernière place** d'une
même offre.

1. Créer deux demandes en attente vers une offre n'ayant qu'une place libre
   (deux candidats confirmés distincts).
2. Approuver la première → succès.
3. Approuver la seconde → **« L'offre cible est complète. »** (HTTP 409), et
   surtout : rien n'a bougé pour ce second candidat.

```sql
-- Contrôle : l'offre n'est pas en surcapacité
select o.id, o.slots, count(a.id) filter (where a.status = 'confirmed') as occupees
from internship_offers o left join assignments a on a.offer_id = o.id
where o.id = <OFFER_ID> group by o.id;
-- occupees <= slots
```

Le pré-contrôle TypeScript donne le message lisible ; c'est la RPC, qui verrouille
l'offre (`select … for update`) puis recompte, qui garantit qu'on ne dépasse
jamais la capacité même si les deux clics tombent en même temps.

## 7. Cloisonnement

| Test | Attendu |
| --- | --- |
| `GET /api/offer-switch-requests` sans jeton | 401 |
| `GET /api/offer-switch-requests` avec un jeton candidat | 403 (réservé au personnel) |
| `GET /api/my-switch-requests` avec un jeton candidat | Uniquement ses propres demandes |
| `POST /api/notifications/<id>/read` sur la notification d'un autre compte | 404 (le filtre `user_id` s'applique aussi à l'écriture) |
| Ouvrir l'URL de la preuve après 1 h | Expirée — le bucket est privé, l'URL est signée |
