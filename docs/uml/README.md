# Modélisation UML — Assistant IA de gestion des stages

Modélisation du projet suivant les conventions du cours UML (cycle en V, niveaux
analyse / conception) et du cours Agilité & Scrum.

Chaque diagramme existe sous **trois formes** :

| Forme | Dossier | Usage |
|---|---|---|
| **PlantUML** (`.puml`) | [`plantuml/`](plantuml) | Notation UML normative — stéréotypes, `«includes»`, agrégation/composition, `ref`, couloirs. C'est la source de référence. |
| **Mermaid** (`.mmd`) | [`mermaid/`](mermaid) | Rendu natif par GitHub et par la plupart des éditeurs Markdown, sans outil externe. |
| **Images** (`.png`, `.svg`) | [`img/`](img) | Prêtes à coller dans le rapport. `img/*.png` vient de Mermaid, `img/plantuml/*.png` de PlantUML. |

---

## Les diagrammes

| # | Diagramme | Phase | Ce qu'il montre |
|---|---|---|---|
| 01 | Cas d'utilisation | Analyse | Les 4 acteurs et leurs objectifs, avec généralisation de rôle et relations `«includes»` / `«extends»` |
| 02 | Classes | Conception | Le modèle du domaine : candidats, offres, candidatures, affectations, compétences, avec multiplicités et contraintes |
| 03 | Séquence — Postuler | Conception | Le dépôt d'une candidature, dont le passage du CV par une URL signée |
| 04 | Séquence — Analyse du CV | Conception | L'analyse asynchrone : extraction, cache LLM, scoring |
| 05 | Séquence — Affectation IA | Conception | Scoring de tous les couples, algorithme hongrois, puis validation humaine |
| 06 | États-transitions | Conception | Le cycle de vie d'une candidature (`submitted` → … → `assigned`) |
| 07 | Activités | Analyse | Le parcours complet en couloirs, du dépôt à la réservation de la place |
| 08 | Composants | Conception | L'architecture logique : SPA, endpoints, noyau partagé, services externes |
| 09 | Déploiement | Conception | La configuration physique : Vercel, Supabase, Groq |

---

## 01 — Cas d'utilisation

![Cas d'utilisation](img/01-cas-utilisation.png)

La **généralisation de rôle** évite de redessiner les mêmes associations : un
Candidat fait tout ce que fait un Visiteur, un Administrateur tout ce que fait un
Recruteur. `«includes»` marque un sous-scénario obligatoire et factorisé
(s'authentifier, déposer son CV), `«extends»` un sous-scénario optionnel
(consulter le CV, relancer l'analyse).

## 02 — Diagramme de classes

![Classes](img/02-classes.png)

Conventions respectées : aucun attribut n'est typé par une classe du diagramme
(on met une association), les attributs dérivés sont préfixés `/`
(`/end_date`, `/taux_remplissage`), les contraintes sont en notes.

La composition entre `Candidature` et `Document` traduit un cycle de vie lié :
supprimer une candidature supprime ses pièces jointes, y compris le fichier
dans le stockage.

## 03 — Séquence : postuler à une offre

![Séquence postuler](img/03-sequence-postuler.png)

Le CV ne traverse jamais la fonction serverless : le navigateur obtient une URL
signée puis téléverse directement vers le stockage. Le déclenchement de
l'analyse est un **message asynchrone** — la réponse HTTP ne l'attend pas.

## 04 — Séquence : analyse du CV

![Séquence analyse](img/04-sequence-analyse-cv.png)

Le cache indexé par empreinte SHA-256 du texte fait qu'un CV déjà vu ne
consomme aucun jeton LLM. L'échec d'extraction fait basculer la candidature
dans l'état `failed` du diagramme 06.

## 05 — Séquence : affectation IA

![Séquence affectation](img/05-sequence-affectation.png)

L'algorithme hongrois travaille sur une matrice où **chaque place** (et non
chaque offre) est une colonne : une offre à 3 places peut donc recevoir
3 candidats. L'optimum est global, pas glouton. L'IA propose, le recruteur
décide : c'est la confirmation qui réserve réellement la place.

## 06 — États-transitions d'une candidature

![États-transitions](img/06-etats-candidature.png)

Niveau conception : les événements sont des **appels d'opérations**. Les actions
`Entry` / `Do` sont portées en notes, faute de notation dédiée en Mermaid — la
version PlantUML les place dans le compartiment de l'état.

## 07 — Activités (couloirs)

![Activités](img/07-activites-candidature.png)

La barre de synchronisation montre le point clé de l'expérience : la
confirmation part vers le candidat **en parallèle** de l'analyse du CV, qui se
poursuit en arrière-plan.

## 08 — Composants

![Composants](img/08-composants.png)

Le noyau `_shared` est ce qui rend l'architecture testable : `scoring`,
`hungarian` et `xgb-predict` sont des bibliothèques pures, sans accès réseau ni
base, donc vérifiables par des tests unitaires.

## 09 — Déploiement

![Déploiement](img/09-deploiement.png)

Une seule fonction serverless sert toutes les routes. Le modèle XGBoost est
entraîné hors ligne et embarqué au build : aucune dépendance native à
l'exécution.

---

## Régénérer les images

**Depuis Mermaid** (jeu complet, aucun outil système requis) — un script
Playwright charge le bundle mermaid installé localement et exporte SVG + PNG :

```bash
npm i mermaid playwright-core
node render-mmd.js
```

**Depuis PlantUML** — nécessite Java :

```bash
java -jar plantuml.jar -tpng -o ../img/plantuml plantuml/*.puml
```

> ⚠️ Les diagrammes PlantUML **autres que les séquences** (classes, cas
> d'utilisation, états, activités, composants, déploiement) exigent
> **Graphviz** ; sans lui PlantUML produit une image d'erreur. Sous Windows :
> `winget install Graphviz`, puis ajouter `dot.exe` au `PATH`. Les images
> livrées dans `img/` viennent donc de Mermaid, et `img/plantuml/` ne contient
> que les trois séquences.

## Limites connues des rendus Mermaid

Mermaid n'a pas de type de diagramme natif pour les cas d'utilisation, les
activités, les composants ni le déploiement : ils sont approchés par des
`flowchart` (sous-graphe = limites du système ou couloir, stéréotypes en texte).
Pour un rapport où la notation compte, utiliser les rendus PlantUML.
