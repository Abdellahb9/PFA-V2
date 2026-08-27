// Shared DB helpers (Supabase service role): skill upsert + matching profiles.
import { admin } from "./supabase";
import { canonicalize, categoryOf, normalize } from "./skills";
import type { CandidateProfile, OfferProfile } from "./scoring";
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
