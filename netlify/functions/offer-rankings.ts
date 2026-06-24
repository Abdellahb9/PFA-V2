// GET /api/offer-rankings — for EVERY open offer, rank ALL parsed candidates by
// composite score (skills + education). Independent of the global Hungarian
// assignment: shows every compatible candidate per offer, best first.
import { requireStaff } from "./_shared/auth";
import { json, fail } from "./_shared/http";
import { loadCandidateProfiles, loadOfferProfiles } from "./_shared/db";
import { compositeScore } from "./_shared/scoring";

export const config = { path: "/api/offer-rankings" };

export default async (req: Request): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);

  const url = new URL(req.url);
  const wSkills = Number(url.searchParams.get("skills") ?? 0.7);
  const wEducation = Number(url.searchParams.get("education") ?? 0.3);
  const limit = Number(url.searchParams.get("limit") ?? 15);

  const candidates = await loadCandidateProfiles();
  const offers = await loadOfferProfiles();

  const rankings = offers.map((offer) => {
    const ranked = candidates
      .map((c) => {
        const { score, breakdown } = compositeScore(c, offer, wSkills, wEducation);
        return {
          application_id: c.applicationId,
          candidate_id: c.candidateId,
          candidate_name: c.name,
          match_score: score,
          score_breakdown: breakdown,
        };
      })
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit);
    return {
      offer_id: offer.offerId,
      offer_title: offer.title,
      department_name: offer.departmentName,
      slots: offer.slots,
      candidates: ranked,
    };
  });

  return json(rankings);
};
