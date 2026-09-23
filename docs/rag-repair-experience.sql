-- =============================================================================
-- REPÉRAGE ET RÉPARATION — l'âge enregistré comme expérience.
--
-- Constaté : le candidat « m bed » porte 22 ans d'expérience, qui est son ÂGE.
-- Le correctif de code empêche que cela se reproduise, mais il ne touche PAS
-- les lignes déjà écrites : l'analyse de CV n'est pas rejouée toute seule.
--
-- À exécuter dans le SQL Editor de Supabase. Le bloc 1 ne fait que LIRE.
-- =============================================================================

-- 1) REPÉRAGE — qui est touché ? ---------------------------------------------
-- Un stagiaire est un étudiant : au-delà de 15 ans d'expérience, la valeur est
-- presque toujours un âge. La colonne `indice` dit ce que le CV contient
-- réellement, pour trancher sans ouvrir chaque dossier.

select
  c.id,
  trim(c.first_name || ' ' || c.last_name)                   as nom,
  c.years_experience                                          as experience_enregistree,
  case
    when c.cv_text ~* '\m(\d{1,2})\s*ans?\M[^.\n]{0,20}exp[ée]rience'
      or c.cv_text ~* 'exp[ée]rience[^.\n]{0,20}\m(\d{1,2})\s*ans?\M'
      then 'le CV mentionne une vraie expérience'
    when c.cv_text ~* '\m\d{1,2}\s*ans?\M'
      then 'le CV ne mentionne « N ans » que hors contexte (probablement un âge)'
    else 'le CV ne mentionne aucune durée'
  end                                                         as indice,
  substring(c.cv_text from '.{0,60}\m\d{1,2}\s*ans?\M.{0,40}') as extrait_du_cv
from public.candidates c
where c.years_experience > 15
order by c.years_experience desc, c.id;


-- 2) COMBIEN DE PROFILS SONT CONCERNÉS ? -------------------------------------
select
  count(*) filter (where years_experience > 15)  as suspects,
  count(*) filter (where years_experience > 40)  as certainement_un_age,
  count(*)                                        as total_candidats,
  round(avg(years_experience), 2)                 as moyenne_actuelle
from public.candidates;


-- 3) RÉPARATION — à n'exécuter qu'APRÈS avoir lu le bloc 1. -------------------
-- Remet à 0 (« inconnu ») les valeurs invraisemblables pour un stage. 0 est la
-- valeur par défaut du champ et signifie déjà « non extrait » dans tout le
-- code : l'assistant l'affichera comme tel au lieu d'inventer une carrière.
--
-- Décommentez pour l'appliquer.
--
-- update public.candidates
--    set years_experience = 0
--  where years_experience > 15;


-- 4) VARIANTE PLUS FINE — ne corriger que les cas sans preuve dans le CV. ----
-- Préserve un profil dont le CV dit vraiment « 18 ans d'expérience ».
--
-- update public.candidates c
--    set years_experience = 0
--  where c.years_experience > 15
--    and c.cv_text !~* '\m\d{1,2}\s*ans?\M[^.\n]{0,20}exp[ée]rience'
--    and c.cv_text !~* 'exp[ée]rience[^.\n]{0,20}\m\d{1,2}\s*ans?\M';


-- 5) CONTRÔLE APRÈS RÉPARATION ------------------------------------------------
-- Attendu : zéro ligne.
-- select id, trim(first_name || ' ' || last_name) as nom, years_experience
--   from public.candidates where years_experience > 15;
