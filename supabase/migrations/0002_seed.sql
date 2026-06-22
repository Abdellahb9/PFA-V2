-- =============================================================================
-- Demo data: skills, departments, offers (+ required skills), a few parsed
-- candidates (so matching has something to optimise). Idempotent.
-- Run after 0001_init.sql.  NOTE: the admin user is created via Supabase Auth
-- (Authentication → Add user), then: update public.profiles set role='admin'
-- where id = (select id from auth.users where email = '<your-admin-email>');
-- =============================================================================

-- ---- Skills (normalized == canonical) ----
insert into public.skills (name, normalized, category) values
  ('python','python','technical'), ('sql','sql','technical'),
  ('machine learning','machine learning','technical'), ('nlp','nlp','technical'),
  ('data science','data science','technical'), ('docker','docker','technical'),
  ('data analysis','data analysis','technical'), ('automation','automation','domain'),
  ('electrical engineering','electrical engineering','domain'),
  ('maintenance','maintenance','domain'), ('process engineering','process engineering','domain'),
  ('chemistry','chemistry','domain'), ('quality','quality','domain'),
  ('communication','communication','soft')
on conflict (normalized) do nothing;

-- ---- Departments ----
insert into public.departments (name, code, capacity, supervisor_name) values
  ('Direction des Systèmes d''Information','DSI',4,'M. El Amrani'),
  ('Maintenance Industrielle','MAINT',3,'Mme Bennani'),
  ('Génie des Procédés','PROC',3,'M. Tazi'),
  ('Qualité, Hygiène, Sécurité & Environnement','QHSE',2,'Mme Idrissi')
on conflict (code) do nothing;

-- ---- Offers ----
insert into public.internship_offers (department_id, title, field, slots, min_education_level, status, description)
select d.id, v.title, v.field, v.slots, v.lvl, 'open', 'Stage au sein du département ' || d.name
from (values
  ('DSI','Stage Développement IA / NLP','Informatique',2,'Bac+5'),
  ('DSI','Stage Data Science','Data Science',1,'Bac+4'),
  ('MAINT','Stage Automatisme & GMAO','Génie électrique',2,'Bac+3'),
  ('PROC','Stage Optimisation des Procédés','Génie des procédés',2,'Bac+5'),
  ('QHSE','Stage Système Qualité ISO 9001','Qualité',1,'Bac+3')
) as v(code,title,field,slots,lvl)
join public.departments d on d.code = v.code
where not exists (select 1 from public.internship_offers o where o.title = v.title);

-- ---- Offer required skills ----
insert into public.offer_skills (offer_id, skill_id, weight, required)
select o.id, s.id, v.w, v.req
from (values
  ('Stage Développement IA / NLP','python',1.0,true),
  ('Stage Développement IA / NLP','nlp',0.9,true),
  ('Stage Développement IA / NLP','machine learning',0.8,false),
  ('Stage Data Science','python',1.0,true),
  ('Stage Data Science','data science',0.9,true),
  ('Stage Data Science','sql',0.7,false),
  ('Stage Automatisme & GMAO','automation',1.0,true),
  ('Stage Automatisme & GMAO','electrical engineering',0.8,true),
  ('Stage Optimisation des Procédés','process engineering',1.0,true),
  ('Stage Optimisation des Procédés','chemistry',0.7,false),
  ('Stage Système Qualité ISO 9001','quality',1.0,true)
) as v(title,skill,w,req)
join public.internship_offers o on o.title = v.title
join public.skills s on s.normalized = v.skill
on conflict (offer_id, skill_id) do nothing;

-- ---- Demo candidates + parsed applications ----
insert into public.candidates (first_name, last_name, email, field_of_study, education_level, cv_text)
select v.fn, v.ln, v.email, v.field, v.lvl, v.fn || ' ' || v.ln || ' - ' || v.field
from (values
  ('Youssef','El Khattabi','youssef.elk@example.ma','Informatique','Bac+5'),
  ('Salma','Benjelloun','salma.benj@example.ma','Data Science','Bac+5'),
  ('Omar','Fassi','omar.fassi@example.ma','Génie électrique','Bac+3'),
  ('Imane','Cherkaoui','imane.cherk@example.ma','Génie des procédés','Bac+5')
) as v(fn,ln,email,field,lvl)
where not exists (select 1 from public.candidates c where c.email = v.email);

insert into public.candidate_skills (candidate_id, skill_id, weight)
select c.id, s.id, 0.9
from (values
  ('youssef.elk@example.ma','python'), ('youssef.elk@example.ma','nlp'),
  ('youssef.elk@example.ma','machine learning'), ('youssef.elk@example.ma','docker'),
  ('salma.benj@example.ma','python'), ('salma.benj@example.ma','data science'),
  ('salma.benj@example.ma','sql'),
  ('omar.fassi@example.ma','automation'), ('omar.fassi@example.ma','electrical engineering'),
  ('omar.fassi@example.ma','maintenance'),
  ('imane.cherk@example.ma','process engineering'), ('imane.cherk@example.ma','chemistry')
) as v(email,skill)
join public.candidates c on c.email = v.email
join public.skills s on s.normalized = v.skill
on conflict (candidate_id, skill_id) do nothing;

insert into public.applications (candidate_id, status, motivation)
select c.id, 'parsed', 'Candidature de démonstration'
from public.candidates c
where c.email in ('youssef.elk@example.ma','salma.benj@example.ma','omar.fassi@example.ma','imane.cherk@example.ma')
  and not exists (select 1 from public.applications a where a.candidate_id = c.id);
