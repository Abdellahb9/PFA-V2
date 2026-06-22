// Composite candidate <-> offer score: weighted skill overlap + education fit.
// No semantic embeddings (serverless); skills are LLM-normalised upstream.

const EDUCATION_RANK: Record<string, number> = {
  bac: 1, "bac+1": 2, "bac+2": 3, dut: 3, bts: 3,
  licence: 4, "bac+3": 4, bachelor: 4,
  "master 1": 5, "bac+4": 5,
  master: 6, "master 2": 6, "bac+5": 6, ingenieur: 6, engineer: 6,
  doctorat: 7, phd: 7,
};

export interface CandidateProfile {
  candidateId: number;
  applicationId: number;
  name: string;
  skills: Map<string, number>; // canonical skill -> weight
  educationLevel: string | null;
}

export interface OfferProfile {
  offerId: number;
  title: string;
  departmentName: string;
  slots: number;
  skills: Map<string, number>; // required skill -> importance
  minEducationLevel: string | null;
}

export interface ScoreBreakdown {
  skills: number;
  education: number;
  weights: { skills: number; education: number };
}

function levelRank(level: string | null): number | null {
  if (!level) return null;
  return EDUCATION_RANK[level.trim().toLowerCase()] ?? null;
}

export function skillOverlap(candidate: Map<string, number>, offer: Map<string, number>): number {
  if (offer.size === 0) return 0;
  let total = 0;
  let matched = 0;
  for (const [skill, importance] of offer) {
    total += importance;
    const have = candidate.get(skill);
    if (have !== undefined) matched += importance * Math.min(1, have);
  }
  return total === 0 ? 0 : Math.max(0, Math.min(1, matched / total));
}

export function educationFit(candidateLevel: string | null, minLevel: string | null): number {
  const required = levelRank(minLevel);
  if (required === null) return 1;
  const have = levelRank(candidateLevel);
  if (have === null) return 0.5;
  if (have >= required) return 1;
  return Math.max(0, 1 - 0.4 * (required - have));
}

export function compositeScore(
  candidate: CandidateProfile,
  offer: OfferProfile,
  wSkills = 0.7,
  wEducation = 0.3,
): { score: number; breakdown: ScoreBreakdown } {
  const skl = skillOverlap(candidate.skills, offer.skills);
  const edu = educationFit(candidate.educationLevel, offer.minEducationLevel);
  const totalW = wSkills + wEducation || 1;
  const score = (wSkills * skl + wEducation * edu) / totalW;
  return {
    score: round4(score),
    breakdown: {
      skills: round4(skl),
      education: round4(edu),
      weights: { skills: wSkills, education: wEducation },
    },
  };
}

export const round4 = (x: number): number => Math.round(x * 10000) / 10000;
