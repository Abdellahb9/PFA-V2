-- Jeu de données SYNTHÉTIQUE de l'assistant (tests SQL et évaluation eval:rag).
-- Personne réelle : aucune. S'ajoute aux données de démonstration de la
-- migration 0002 (Youssef El Khattabi, Salma Benjelloun, Omar Fassi, Imane
-- Cherkaoui ; 5 offres ouvertes).
--
-- Les CV de Yasmine, Karim et Hajar sont indexés à part, depuis
-- lib/rag/__fixtures__/ (voir seedAssistantDb dans __tests__/helpers.ts).
-- « Youssef Amrani » existe pour l'ambiguïté : « Youssef » et « Amrani »
-- désignent chacun deux personnes.

insert into public.skills (name, normalized, category) values
  ('power bi','power bi','technical'), ('sap','sap','technical'),
  ('lean','lean','domain'), ('logistics','logistics','domain'),
  ('rust','rust','technical'), ('go','go','technical'),
  ('typescript','typescript','technical'), ('kubernetes','kubernetes','technical'),
  ('plc','plc','technical'), ('civil engineering','civil engineering','domain')
on conflict (normalized) do nothing;

insert into public.departments (name, code, capacity, supervisor_name) values
  ('Logistique & Supply Chain','LOG',2,'M. Alaoui')
on conflict (code) do nothing;

insert into public.internship_offers (department_id, title, field, slots, min_education_level, status, description)
select d.id, v.title, v.field, v.slots, v.lvl, v.status, v.descr
from (values
  ('LOG','Stage Logistique & Amélioration continue','Génie industriel',1,'Bac+4','open',
   'Cartographie des flux, Lean, tableaux de bord Power BI.'),
  ('MAINT','Stage Maintenance prédictive 2025','Génie électrique',1,'Bac+3','closed',
   'Offre de la session précédente, clôturée.')
) as v(code,title,field,slots,lvl,status,descr)
join public.departments d on d.code = v.code
where not exists (select 1 from public.internship_offers o where o.title = v.title);

insert into public.offer_skills (offer_id, skill_id, weight, required)
select o.id, s.id, v.w, v.req
from (values
  ('Stage Logistique & Amélioration continue','lean',1.0,true),
  ('Stage Logistique & Amélioration continue','power bi',0.8,false),
  ('Stage Logistique & Amélioration continue','logistics',0.9,true)
) as v(title,skill,w,req)
join public.internship_offers o on o.title = v.title
join public.skills s on s.normalized = v.skill
on conflict (offer_id, skill_id) do nothing;

insert into public.candidates (first_name, last_name, email, phone, field_of_study, education_level, university, years_experience, cv_text)
select v.fn, v.ln, v.email, v.phone, v.field, v.lvl, v.uni, v.exp, null
from (values
  ('Yasmine','El Amrani','yasmine.elamrani@example.com','+212600000001','Génie industriel','Bac+5',
   'ENSA Agadir — Université Ibn Zohr', 0),
  ('Karim','Benali','karim.benali@example.com','+212600000002','Génie logiciel','Bac+5',
   'École Mohammadia d''Ingénieurs', 0),
  ('Hajar','Ait Ouarab','hajar.aitouarab@example.com','+212600000003','Électromécanique','Bac+2',
   'Lycée technique Al Massira, Laâyoune', 0),
  ('Youssef','Amrani','youssef.amrani@example.com','+212600000004','Génie civil','Bac+3',
   'Université Hassan II', 1)
) as v(fn,ln,email,phone,field,lvl,uni,exp)
where not exists (select 1 from public.candidates c where c.email = v.email);

insert into public.candidate_skills (candidate_id, skill_id, weight)
select c.id, s.id, v.w
from (values
  ('yasmine.elamrani@example.com','lean',0.9), ('yasmine.elamrani@example.com','power bi',0.9),
  ('yasmine.elamrani@example.com','sap',0.8), ('yasmine.elamrani@example.com','logistics',0.9),
  ('yasmine.elamrani@example.com','sql',0.6),
  ('karim.benali@example.com','rust',0.9), ('karim.benali@example.com','go',0.9),
  ('karim.benali@example.com','typescript',0.8), ('karim.benali@example.com','python',0.8),
  ('karim.benali@example.com','kubernetes',0.8), ('karim.benali@example.com','docker',0.8),
  ('hajar.aitouarab@example.com','maintenance',0.9), ('hajar.aitouarab@example.com','plc',0.8),
  ('hajar.aitouarab@example.com','electrical engineering',0.8),
  ('youssef.amrani@example.com','civil engineering',0.9)
) as v(email,skill,w)
join public.candidates c on c.email = v.email
join public.skills s on s.normalized = v.skill
on conflict (candidate_id, skill_id) do nothing;

-- Candidatures : une par personne, aux statuts variés. Youssef Amrani n'a postulé
-- à aucune offre (vivier).
insert into public.applications (candidate_id, offer_id, status, match_score, motivation, start_date, duration_months)
select c.id, o.id, v.status, v.score, v.motivation, v.start::date, v.months
from (values
  ('yasmine.elamrani@example.com','Stage Logistique & Amélioration continue','under_review',0.82,
   'Je souhaite appliquer le Lean aux flux de Phosboucraa.','2027-02-01',6),
  ('karim.benali@example.com','Stage Développement IA / NLP','parsed',0.74,
   'Passionné par les systèmes backend et l''IA.',null,null),
  ('hajar.aitouarab@example.com','Stage Automatisme & GMAO','assigned',0.88,
   'Je connais déjà les convoyeurs de la laverie.','2026-11-01',3),
  ('youssef.amrani@example.com',null,'parsed',null,
   'Candidature spontanée.',null,null)
) as v(email,offer,status,score,motivation,start,months)
join public.candidates c on c.email = v.email
left join public.internship_offers o on o.title = v.offer
where not exists (select 1 from public.applications a where a.candidate_id = c.id);

-- Salma (démo 0002) : rattachée à l'offre Data Science, en cours d'examen.
update public.applications a
   set offer_id = (select id from public.internship_offers where title = 'Stage Data Science'),
       status = 'under_review',
       match_score = 0.91
  from public.candidates c
 where c.id = a.candidate_id and c.email = 'salma.benj@example.ma' and a.offer_id is null;

-- Affectation confirmée de Hajar, avec le détail du score.
insert into public.assignments (application_id, candidate_id, offer_id, match_score, score_breakdown, status, decided_by)
select a.id, a.candidate_id, a.offer_id, 0.88,
       '{"skills": 0.8286, "education": 1, "weights": {"skills": 0.7, "education": 0.3}}'::jsonb,
       'confirmed', 'admin@phosboucraa.ma'
  from public.applications a
  join public.candidates c on c.id = a.candidate_id
 where c.email = 'hajar.aitouarab@example.com'
   and not exists (select 1 from public.assignments g where g.application_id = a.id);

-- Note du recruteur, saisie depuis l'interface.
insert into public.candidate_notes (candidate_id, author_name, body, source)
select c.id, 'Mme Bennani',
       'Entretien du 12 mars : très bon en backend, disponible uniquement à partir de mars 2027.',
       'ui'
  from public.candidates c
 where c.email = 'karim.benali@example.com'
   and not exists (select 1 from public.candidate_notes n where n.candidate_id = c.id);
