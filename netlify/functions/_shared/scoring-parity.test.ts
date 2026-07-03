// Cross-stack scoring parity: TS engine vs backend/app/services/matching/scoring.py.
// Both suites consume the same golden fixtures (shared/fixtures/scoring-parity.json),
// so a change to one implementation that is not mirrored in the other fails CI on
// whichever side drifted. Composite cases match Python run with w_semantic=0.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  compositeScore,
  educationFit,
  skillOverlap,
  type CandidateProfile,
  type OfferProfile,
} from "./scoring";

interface EducationCase {
  name: string;
  candidate: string | null;
  required: string | null;
  expected: number;
}

interface OverlapCase {
  name: string;
  candidate: Record<string, number>;
  offer: Record<string, number>;
  expected: number;
}

interface CompositeCase {
  name: string;
  candidateSkills: Record<string, number>;
  candidateLevel: string | null;
  offerSkills: Record<string, number>;
  minLevel: string | null;
  wSkills: number;
  wEducation: number;
  expected: number;
}

const fixtures = JSON.parse(
  readFileSync(new URL("../../../shared/fixtures/scoring-parity.json", import.meta.url), "utf-8"),
) as {
  educationFit: EducationCase[];
  skillOverlap: OverlapCase[];
  composite: CompositeCase[];
};

const toMap = (skills: Record<string, number>): Map<string, number> =>
  new Map(Object.entries(skills));

describe("educationFit matches the Python engine", () => {
  it.each(fixtures.educationFit)("$name", (c) => {
    expect(educationFit(c.candidate, c.required)).toBeCloseTo(c.expected, 4);
  });
});

describe("skillOverlap matches the Python engine", () => {
  it.each(fixtures.skillOverlap)("$name", (c) => {
    expect(skillOverlap(toMap(c.candidate), toMap(c.offer))).toBeCloseTo(c.expected, 4);
  });
});

describe("compositeScore matches the Python engine (w_semantic=0)", () => {
  it.each(fixtures.composite)("$name", (c) => {
    const candidate: CandidateProfile = {
      candidateId: 1,
      applicationId: 1,
      name: "Parity",
      skills: toMap(c.candidateSkills),
      educationLevel: c.candidateLevel,
    };
    const offer: OfferProfile = {
      offerId: 1,
      title: "Parity",
      departmentName: "DSI",
      slots: 1,
      skills: toMap(c.offerSkills),
      minEducationLevel: c.minLevel,
    };
    const { score } = compositeScore(candidate, offer, c.wSkills, c.wEducation);
    expect(score).toBeCloseTo(c.expected, 4);
  });
});
