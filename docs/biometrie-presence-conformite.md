# Suivi de présence biométrique — Conformité & Architecture (Phase 2)

> **STATUT : VERROUILLÉ.** Aucun code de capture ou de reconnaissance faciale ne
> sera écrit tant que la base légale n'est pas **confirmée par écrit** et que
> l'**autorisation préalable de la CNDP** n'est pas obtenue. Ce document ne
> contient **aucune** implémentation — il cadre la conformité et l'architecture.
>
> Ce document n'est pas un avis juridique : il doit être validé par un
> conseil juridique / DPO et déposé auprès de la CNDP.

---

## 1. Contexte

Après affectation, on souhaite suivre la présence des stagiaires pendant la durée
du stage. La reconnaissance faciale traite des **données biométriques**, qui sont
des **données personnelles sensibles**. Elle n'est donc envisageable que si elle
est **strictement nécessaire et proportionnée**, avec un **repli non biométrique**
toujours disponible.

---

## 2. Base légale

### 2.1 Maroc — Loi 09-08 & CNDP
- La **loi n° 09-08** relative à la protection des personnes physiques à l'égard
  du traitement des données à caractère personnel encadre ce traitement ; la
  **CNDP** en est l'autorité de contrôle.
- Les données biométriques relèvent d'un régime renforcé : le traitement est
  soumis à **autorisation préalable de la CNDP** (et non à simple déclaration).
- Principes obligatoires : **finalité déterminée** (présence uniquement),
  **proportionnalité** (démontrer qu'aucune alternative moins intrusive ne
  suffit), **consentement**, **durée de conservation limitée**, **sécurité**,
  **droits des personnes** (accès, rectification, opposition, suppression).

### 2.2 UE — RGPD (pour tout stagiaire ressortissant UE / données transférées en UE)
- Les données biométriques utilisées pour **identifier** une personne sont une
  **catégorie particulière** (art. 9 RGPD) : traitement interdit sauf exception,
  la plus adaptée ici étant le **consentement explicite** (art. 9-2-a).
- **AIPD / DPIA obligatoire** (art. 35) : la reconnaissance faciale à grande
  échelle est un traitement « à risque élevé ».
- Principes : minimisation, limitation des finalités, limitation de conservation,
  sécurité, transparence, droits (accès, effacement, portabilité, opposition).

### 2.3 Conclusion base légale
- **Fondement retenu : consentement explicite, éclairé, libre et révocable.**
- Pour que le consentement soit **libre**, la présence biométrique ne peut **pas**
  être une **condition** du stage : une **alternative non biométrique équivalente**
  doit exister (cf. §4). Un stagiaire qui refuse ne subit **aucun préjudice**.

---

## 3. Consentement

- **Explicite & spécifique** : formulaire dédié, distinct du contrat de stage,
  décrivant la finalité (présence), les données, la durée, les droits.
- **Éclairé** : notice d'information (responsable de traitement, finalité, base
  légale, destinataires, durée, droits, contact DPO, droit de réclamation CNDP).
- **Libre** : opt-in ; le repli QR/badge est proposé au même niveau de service.
  ⚠️ **Déséquilibre employeur/stagiaire** : dans une relation employeur–stagiaire,
  le consentement peut ne pas être considéré comme « libre » (déséquilibre de
  pouvoir). Conséquence directe : le pointage biométrique **ne peut pas être
  imposé** ; le repli non biométrique doit être proposé **sans aucun
  désavantage** pour qui le choisit.
- **Révocable à tout moment** : la révocation déclenche la **suppression** du
  gabarit et bascule le stagiaire sur le repli, sans conséquence.
- **Traçabilité du consentement** : date, version de la notice, canal, preuve
  conservée séparément.
- **Mineurs** : consentement du représentant légal si applicable.

---

## 4. Repli non biométrique (OBLIGATOIRE, mode par défaut)

- **QR / badge** : chaque stagiaire reçoit un QR (ou badge) scanné à l'arrivée/départ.
- Alternatives équivalentes : **code PIN** personnel, ou **pointage manuel** validé
  par l'encadrant.
- C'est le **mode par défaut** ; la biométrie est une option opt-in qui n'apporte
  aucun avantage de traitement (mêmes droits, même suivi).

---

## 5. Conservation & suppression

- **Ne jamais stocker les images/vidéos brutes du visage.** Stocker uniquement un
  **gabarit** mathématique (vecteur), **chiffré**, non réversible en image.
- **Durée** : limitée à la **durée du stage**. Suppression automatique :
  - à la **fin du stage** (+ éventuel délai légal court pour litige/paie, à faire
    valider) ;
  - à la **révocation du consentement** ;
  - au **retrait** de la candidature/affectation.
- **Journaux de présence** (horodatages) : conservés selon l'obligation RH, mais
  **dissociés** du gabarit biométrique une fois le stage terminé.
- **Pipeline de suppression** documenté, testé, et **auditable** (qui/quoi/quand).

---

## 6. Sécurité & minimisation

- **Minimisation** : gabarit uniquement ; pas de galerie de photos.
- **Chiffrement** au repos et en transit ; clés gérées séparément.
- **Traitement en périphérie (edge/on-device)** privilégié : la comparaison se
  fait localement sur le lecteur, seul le résultat (présent/absent) remonte.
- **Contrôle d'accès strict** + **journaux d'audit** sur tout accès aux gabarits.
- **Pas de sous-traitant cloud tiers** sans **contrat de sous-traitance (DPA)** et
  vérification des transferts hors Maroc/UE.
- **Pas de finalité secondaire** (ni surveillance, ni évaluation, ni profilage).

---

## 7. Étapes préalables obligatoires (avant tout code)

1. **AIPD / DPIA** rédigée et validée (risques, proportionnalité, alternatives).
2. **Dossier d'autorisation CNDP** déposé et **autorisation obtenue**.
3. **Notice d'information** + **formulaire de consentement** validés (juridique/DPO).
4. **Politique de conservation/suppression** validée et testable.
5. **Validation écrite** du responsable de traitement (PHOSBOUCRAA) de la base légale.

> Tant que 1→5 ne sont pas cochés : **aucun développement** de capture/reconnaissance.

---

## 8. Architecture (cadrage seulement — NON implémentée)

Découplée du reste : la présence est un **module optionnel** post-affectation.

```
[Enrôlement opt-in] --(consentement vérifié)--> [Génération gabarit chiffré]
        |                                                |
   (refus) --> [Mode QR/badge par défaut]               v
                                              [Coffre gabarits chiffré]
                                                         |
[Lecteur en périphérie] --(comparaison locale)----------+
        |
        v
[Résultat présent/absent] --> [Journal de présence (horodatage, sans image)]
                                                         |
                                              [Pipeline de suppression auto]
                                              (fin de stage / révocation)
```

- **Service Présence** = microservice **séparé** (isolation des données sensibles),
  activé par un **flag** et **par stagiaire consentant**.
- **Points de contrôle du consentement** en dur : pas de gabarit sans consentement
  valide ; toute révocation déclenche la suppression.
- **Aucune intégration** avec le moteur d'affectation (Hongrois) ni le scoring.
- **Interfaces** : (a) enrôlement, (b) pointage (biométrique **ou** QR), (c) tableau
  de présence RH, (d) gestion du consentement & suppression.

---

## 9. Go / No-Go

- [ ] Base légale confirmée par écrit (responsable de traitement)
- [ ] Autorisation CNDP obtenue
- [ ] AIPD/DPIA validée
- [ ] Notice + consentement + repli QR/badge en place
- [ ] Politique de conservation/suppression testée

**Tant que ces cases ne sont pas cochées, la reconnaissance faciale n'est pas
développée.** À la place, le **repli QR/badge** (non biométrique) peut, lui, être
implémenté sans ces contraintes.
