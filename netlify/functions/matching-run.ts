// POST /api/matching-run — admin. Runs the Hungarian optimisation; previews by
// default, persists assignments when { persist: true }.
import { requireStaff } from "./_shared/auth";
import { json, fail } from "./_shared/http";
import { loadCandidateProfiles, loadOfferProfiles } from "./_shared/db";
import { solveAssignment } from "./_shared/hungarian";
import { admin } from "./_shared/supabase";

export const config = { path: "/api/matching-run" };

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return fail("Méthode non autorisée", 405);
  const user = await requireStaff(req);
  if (user instanceof Response) return user;

  const body = (await req.json().catch(() => ({}))) as {
    weights?: { skills?: number; education?: number };
    persist?: boolean;
    min_score?: number;
  };
  const candidates = await loadCandidateProfiles();
  const offers = await loadOfferProfiles();
  const outcome = solveAssignment(candidates, offers, body.weights ?? {}, Number(body.min_score ?? 0));

  let runId: number | null = null;
  if (body.persist) {
    const sb = admin();
    const { data: run } = await sb
      .from("matching_runs")
      .insert({
        total_candidates: outcome.totalCandidates,
        total_slots: outcome.totalSlots,
        assignments_count: outcome.pairs.length,
        average_score: outcome.averageScore,
      })
      .select("id")
      .single();
    runId = run?.id ?? null;

    for (const p of outcome.pairs) {
      const { data: existing } = await sb
        .from("assignments")
        .select("id, status")
        .eq("application_id", p.applicationId)
        .maybeSingle();
      if (existing?.status === "confirmed") continue; // never overwrite confirmed
      if (existing) await sb.from("assignments").delete().eq("id", existing.id);
      await sb.from("assignments").insert({
        application_id: p.applicationId,
        candidate_id: p.candidateId,
        offer_id: p.offerId,
        matching_run_id: runId,
        match_score: p.matchScore,
        score_breakdown: p.scoreBreakdown,
        status: "proposed",
      });
      await sb.from("applications").update({ match_score: p.matchScore }).eq("id", p.applicationId);
    }
  }

  return json({
    matching_run_id: runId,
    algorithm: "hungarian",
    total_candidates: outcome.totalCandidates,
    total_slots: outcome.totalSlots,
    assignments_count: outcome.pairs.length,
    total_score: outcome.totalScore,
    average_score: outcome.averageScore,
    persisted: Boolean(body.persist),
    assignments: outcome.pairs.map((p) => ({
      application_id: p.applicationId,
      candidate_id: p.candidateId,
      candidate_name: p.candidateName,
      offer_id: p.offerId,
      offer_title: p.offerTitle,
      department_name: p.departmentName,
      match_score: p.matchScore,
      score_breakdown: p.scoreBreakdown,
    })),
  });
};
