// Optimal intern assignment via the Hungarian algorithm (Kuhn-Munkres, O(n^3)).
// Offers are expanded into one column per slot (capacity); the score matrix is
// padded to a square so surplus rows/cols stay unassigned.
import {
  compositeScore,
  round4,
  type CandidateProfile,
  type OfferProfile,
  type ScoreBreakdown,
} from "./scoring";

export interface MatchPair {
  applicationId: number;
  candidateId: number;
  candidateName: string;
  offerId: number;
  offerTitle: string;
  departmentName: string;
  matchScore: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface MatchingOutcome {
  totalCandidates: number;
  totalSlots: number;
  pairs: MatchPair[];
  totalScore: number;
  averageScore: number;
}

/** Min-cost assignment on a square cost matrix. Returns rowAssign[i] = col. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0); // p[j] = row matched to column j
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else { minv[j] -= delta; }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const rowAssign = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) rowAssign[p[j] - 1] = j - 1;
  return rowAssign;
}

export function solveAssignment(
  candidates: CandidateProfile[],
  offers: OfferProfile[],
  weights: { skills?: number; education?: number } = {},
  minScore = 0,
): MatchingOutcome {
  // Expand offers into one slot-column each.
  const slots: OfferProfile[] = [];
  for (const offer of offers) {
    for (let s = 0; s < Math.max(0, offer.slots); s++) slots.push(offer);
  }
  const C = candidates.length;
  const K = slots.length;
  if (C === 0 || K === 0) {
    return { totalCandidates: C, totalSlots: K, pairs: [], totalScore: 0, averageScore: 0 };
  }

  const wS = weights.skills ?? 0.7;
  const wE = weights.education ?? 0.3;

  // Score + breakdown matrices (real C x K), then pad to NxN.
  const N = Math.max(C, K);
  const score: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  const breakdowns: (ScoreBreakdown | null)[][] = Array.from({ length: N }, () =>
    new Array(N).fill(null),
  );
  let maxScore = 0;
  for (let i = 0; i < C; i++) {
    for (let j = 0; j < K; j++) {
      const { score: sc, breakdown } = compositeScore(candidates[i], slots[j], wS, wE);
      score[i][j] = sc;
      breakdowns[i][j] = breakdown;
      if (sc > maxScore) maxScore = sc;
    }
  }
  // Cost = maxScore - score (minimise cost == maximise score).
  const cost = score.map((row) => row.map((s) => maxScore - s));
  const rowAssign = hungarian(cost);

  const pairs: MatchPair[] = [];
  for (let i = 0; i < C; i++) {
    const j = rowAssign[i];
    if (j < 0 || j >= K) continue; // dummy column
    const sc = score[i][j];
    if (sc < minScore) continue;
    const cand = candidates[i];
    const offer = slots[j];
    pairs.push({
      applicationId: cand.applicationId,
      candidateId: cand.candidateId,
      candidateName: cand.name,
      offerId: offer.offerId,
      offerTitle: offer.title,
      departmentName: offer.departmentName,
      matchScore: round4(sc),
      scoreBreakdown: breakdowns[i][j]!,
    });
  }
  pairs.sort((a, b) => b.matchScore - a.matchScore);

  const totalScore = round4(pairs.reduce((acc, p) => acc + p.matchScore, 0));
  const averageScore = pairs.length ? round4(totalScore / pairs.length) : 0;
  return { totalCandidates: C, totalSlots: K, pairs, totalScore, averageScore };
}
