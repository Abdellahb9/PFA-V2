// Shared DB helpers (Supabase service role): skill upsert + matching profiles.
import { admin } from "./supabase";
import { canonicalize, categoryOf, normalize } from "./skills";
import type { CandidateProfile, OfferProfile } from "./scoring";
import type { ApplicantRecord, OfferRecord } from "./ranking";
import type { OfferCapacity } from "./offer-switch";

/**
 * Offre + nombre de places déjà confirmées, pour `checkTargetOffer`.
 *
 * `excludeAssignmentId` sert à re-confirmer une affectation déjà confirmée sans
 * qu'elle se compte elle-même et fasse paraître l'offre complète.
 */
export async function loadOfferCapacity(
  offerId: number,
  excludeAssignmentId?: number | null,
): Promise<OfferCapacity | null> {
  const sb = admin();
  const { data: offer } = await sb
    .from("internship_offers")
    .select("id, title, slots, status")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer) return null;

  let q = sb
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("offer_id", offerId)
    .eq("status", "confirmed");
  if (excludeAssignmentId != null) q = q.neq("id", excludeAssignmentId);
  const { count } = await q;

  return { ...offer, confirmed: count ?? 0 };
}

export async function getOrCreateSkill(name: string): Promise<number> {
  const canonical = canonicalize(name);
  const norm = normalize(canonical);
  const sb = admin();
  const { data: existing } = await sb
    .from("skills")
    .select("id")
    .eq("normalized", norm)
    .maybeSingle();
  if (existing) return existing.id as number;

  const { data, error } = await sb
    .from("skills")
    .insert({ name: canonical, normalized: norm, category: categoryOf(canonical) })
    .select("id")
    .single();
  if (error) {
    // Lost a race -> re-select.
    const { data: again } = await sb.from("skills").select("id").eq("normalized", norm).single();
    return again!.id as number;
  }
  return data.id as number;
}

interface SkillRow { weight: number; skill: { normalized: string } | null }

export async function loadCandidateProfiles(): Promise<CandidateProfile[]> {
  const sb = admin();
  const { data } = await sb
    .from("applications")
    .select(
      "id, candidate:candidates(id, first_name, last_name, education_level, candidate_skills(weight, skill:skills(normalized)))",
    )
    .in("status", ["parsed", "under_review"]);

  const profiles: CandidateProfile[] = [];
  for (const app of (data ?? []) as any[]) {
    const c = app.candidate;
    if (!c) continue;
    const skills = new Map<string, number>();
    for (const cs of (c.candidate_skills ?? []) as SkillRow[]) {
      if (cs.skill?.normalized) skills.set(cs.skill.normalized, cs.weight);
    }
    profiles.push({
      candidateId: c.id,
      applicationId: app.id,
      name: `${c.first_name} ${c.last_name}`.trim(),
      skills,
      educationLevel: c.education_level ?? null,
    });
  }
  return profiles;
}

export async function loadOfferProfiles(): Promise<OfferProfile[]> {
  const sb = admin();
  const { data } = await sb
    .from("internship_offers")
    .select(
      "id, title, slots, min_education_level, department:departments(name), offer_skills(weight, skill:skills(normalized))",
    )
    .eq("status", "open");

  const profiles: OfferProfile[] = [];
  for (const o of (data ?? []) as any[]) {
    const skills = new Map<string, number>();
    for (const os of (o.offer_skills ?? []) as SkillRow[]) {
      if (os.skill?.normalized) skills.set(os.skill.normalized, os.weight);
    }
    profiles.push({
      offerId: o.id,
      title: o.title,
      departmentName: o.department?.name ?? "",
      slots: o.slots,
      skills,
      minEducationLevel: o.min_education_level ?? null,
    });
  }
  return profiles;
}

// ---- Vivier complet pour le classement ---------------------------------------
//
// Classer « les meilleurs » exige de voir TOUS les candidats. Or PostgREST plafonne
// une réponse à 1 000 lignes par défaut, sans erreur : au-delà, le reste du vivier
// disparaît en silence. On pagine donc explicitement.

const PAGE_SIZE = 1000;

/**
 * Enchaîne les pages jusqu'à la dernière (incomplète).
 * `fetchPage(from, to)` reçoit des bornes INCLUSIVES, comme `.range()`.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

/** Statuts d'une candidature ANALYSÉE et encore en lice. */
const RANKABLE_STATUSES = ["parsed", "under_review", "assigned"];

export async function loadApplicantPool(): Promise<ApplicantRecord[]> {
  const sb = admin();
  const rows = await fetchAllPages<any>((from, to) =>
    sb
      .from("applications")
      .select(
        "id, status, candidate:candidates(id, first_name, last_name, education_level, " +
          "field_of_study, years_experience, candidate_skills(weight, skill:skills(normalized)))",
      )
      .in("status", RANKABLE_STATUSES)
      .order("id")
      .range(from, to),
  );

  const pool: ApplicantRecord[] = [];
  for (const app of rows) {
    const c = Array.isArray(app.candidate) ? app.candidate[0] : app.candidate;
    if (!c) continue;
    const skills = new Map<string, number>();
    for (const cs of (c.candidate_skills ?? []) as SkillRow[]) {
      if (cs.skill?.normalized) skills.set(cs.skill.normalized, cs.weight);
    }
    pool.push({
      candidateId: c.id,
      applicationId: app.id,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      status: app.status,
      educationLevel: c.education_level ?? null,
      fieldOfStudy: c.field_of_study ?? null,
      yearsExperience: Number(c.years_experience ?? 0),
      skills,
    });
  }
  return pool;
}

interface OfferSkillRow extends SkillRow {
  required: boolean | null;
}

export async function loadOpenOffersWithSkills(): Promise<OfferRecord[]> {
  const sb = admin();
  const rows = await fetchAllPages<any>((from, to) =>
    sb
      .from("internship_offers")
      .select("id, title, field, min_education_level, offer_skills(weight, required, skill:skills(normalized))")
      .eq("status", "open")
      .order("id")
      .range(from, to),
  );

  return rows.map((o) => ({
    offerId: o.id,
    title: o.title,
    field: o.field ?? null,
    minEducationLevel: o.min_education_level ?? null,
    skills: ((o.offer_skills ?? []) as OfferSkillRow[])
      .filter((s) => s.skill?.normalized)
      .map((s) => ({
        skill: s.skill!.normalized,
        weight: Number(s.weight ?? 1),
        required: Boolean(s.required),
      })),
  }));
}
