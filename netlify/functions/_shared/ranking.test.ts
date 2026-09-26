// Classement par filière : déterministe, donc entièrement testable hors ligne.
//
// Le défaut d'origine : « le meilleur en Data Science » était tranché par un
// rang PLEIN-TEXTE (ressemblance lexicale entre la question et le CV), puis trié
// à vue par le modèle. Ces tests verrouillent un classement qui mesure
// l'adéquation — avec le même moteur que la page Affectation IA.
import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ admin: () => ({}) }));

import { resolveField } from "./skills";
import {
  buildFieldProfile,
  rankApplicants,
  type ApplicantRecord,
  type OfferRecord,
} from "./ranking";
import { fetchAllPages } from "./db";

// Offres à l'image du jeu de données de la migration 0002.
const OFFERS: OfferRecord[] = [
  {
    offerId: 1,
    title: "Stage Développement IA / NLP",
    field: "Informatique",
    minEducationLevel: "Bac+5",
    skills: [
      { skill: "python", weight: 1, required: true },
      { skill: "nlp", weight: 0.9, required: true },
      { skill: "machine learning", weight: 0.8, required: false },
    ],
  },
  {
    offerId: 2,
    title: "Stage Data Science",
    field: "Data Science",
    minEducationLevel: "Bac+4",
    skills: [
      { skill: "python", weight: 1, required: true },
      { skill: "data science", weight: 0.9, required: true },
      { skill: "sql", weight: 0.7, required: false },
    ],
  },
  {
    offerId: 3,
    title: "Stage Automatisme & GMAO",
    field: "Génie électrique",
    minEducationLevel: "Bac+3",
    skills: [
      { skill: "automation", weight: 1, required: true },
      { skill: "maintenance", weight: 0.8, required: false },
    ],
  },
];

let nextApp = 100;
const applicant = (
  id: number,
  name: string,
  skills: string[],
  over: Partial<ApplicantRecord> = {},
): ApplicantRecord => ({
  candidateId: id,
  applicationId: nextApp++,
  name,
  status: "parsed",
  educationLevel: "Bac+5",
  fieldOfStudy: "Data Science",
  yearsExperience: 1,
  skills: new Map(skills.map((s) => [s, 0.9])),
  ...over,
});

const profileFor = (req: Parameters<typeof buildFieldProfile>[0]) => {
  const r = buildFieldProfile(req, OFFERS);
  if (!r.ok) throw new Error(r.error);
  return r.profile;
};

// ---- Résolution des filières ------------------------------------------------

describe("resolveField", () => {
  it("ramène les formulations FR/EN à une filière commune", () => {
    expect(resolveField("Informatique")).toBe("informatique");
    expect(resolveField("Génie informatique et réseaux")).toBe("informatique");
    expect(resolveField("Computer Science")).toBe("informatique");
    expect(resolveField("Science des données")).toBe("data science");
    expect(resolveField("Électrotechnique")).toBe("genie electrique");
    expect(resolveField("Chimie industrielle")).toBe("genie des procedes");
  });

  it("compare sur mot entier", () => {
    // « mecanique » ne doit pas sortir de « electromecanique ».
    expect(resolveField("Électromécanique")).toBe("genie electrique");
    // « ia » ne doit pas sortir de « spécialisation ».
    expect(resolveField("Spécialisation commerce")).toBeNull();
  });

  it("préfère la forme la plus longue", () => {
    expect(resolveField("science des données et informatique")).toBe("data science");
  });

  it("renvoie null pour l'inconnu ou le vide", () => {
    expect(resolveField("Poterie")).toBeNull();
    expect(resolveField("")).toBeNull();
    expect(resolveField(null)).toBeNull();
  });
});

// ---- Profil de référence ----------------------------------------------------

describe("buildFieldProfile", () => {
  it("tire le profil d'une filière des offres OUVERTES qui la portent", () => {
    const p = profileFor({ field: "data science" });
    expect(p.basedOnOffers).toEqual(["Stage Data Science"]);
    expect(p.criteria.has("python")).toBe(true);
    expect(p.criteria.has("data science")).toBe(true);
    // Pas les compétences de l'offre IA/NLP, qui relève de l'Informatique.
    expect(p.criteria.has("nlp")).toBe(false);
    expect(p.minEducationLevel).toBe("Bac+4");
  });

  it("ajoute la filière d'études comme critère requis", () => {
    const p = profileFor({ field: "Data Science" });
    expect(p.criteria.get("field:data science")).toBe(1);
    expect(p.required.has("field:data science")).toBe(true);
  });

  it("lit le champ `field` de l'offre avant son titre", () => {
    // Le titre « Développement IA / NLP » contient « IA », mais l'offre relève
    // de l'Informatique : elle ne doit pas nourrir le profil Data Science.
    const p = profileFor({ field: "informatique" });
    expect(p.basedOnOffers).toEqual(["Stage Développement IA / NLP"]);
  });

  it("retombe sur un profil de référence quand aucune offre ne porte la filière", () => {
    const p = profileFor({ field: "finance" });
    expect(p.basedOnOffers).toEqual([]);
    expect(p.criteria.has("finance")).toBe(true);
  });

  it("reproduit EXACTEMENT les compétences d'une offre précise", () => {
    const p = profileFor({ offer: "Stage Automatisme & GMAO" });
    expect([...p.criteria.keys()].sort()).toEqual(["automation", "maintenance"]);
    // Aucune pseudo-compétence : même classement que la page Affectation IA.
    expect([...p.criteria.keys()].some((k) => k.startsWith("field:"))).toBe(false);
    expect(p.minEducationLevel).toBe("Bac+3");
  });

  it("retrouve une offre par id ou par titre partiel", () => {
    expect(profileFor({ offer: "2" }).label).toBe("Stage Data Science");
    expect(profileFor({ offer: "automatisme" }).label).toBe("Stage Automatisme & GMAO");
  });

  it("canonise et ajoute les compétences explicites de la question", () => {
    const p = profileFor({ skills: ["Postgres", "JS"] });
    expect(p.criteria.has("sql")).toBe(true);
    expect(p.criteria.has("javascript")).toBe(true);
    expect(p.label).toContain("compétences");
  });

  it("refuse une filière inconnue au lieu de deviner, en listant les connues", () => {
    const r = buildFieldProfile({ field: "poterie" }, OFFERS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("poterie");
    expect(r.known).toContain("Data Science");
  });

  it("refuse une offre introuvable en listant les offres ouvertes", () => {
    const r = buildFieldProfile({ offer: "Stage astronaute" }, OFFERS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.known).toContain("Stage Data Science");
  });

  it("refuse une demande sans aucun critère", () => {
    expect(buildFieldProfile({}, OFFERS).ok).toBe(false);
  });
});

// ---- Classement --------------------------------------------------------------

describe("rankApplicants", () => {
  it("classe sur l'adéquation, pas sur la ressemblance lexicale", () => {
    const pool = [
      applicant(1, "Partiel", ["python"]),
      applicant(2, "Complet", ["python", "data science", "sql"]),
      applicant(3, "Moyen", ["python", "data science"]),
    ];
    const r = rankApplicants(profileFor({ field: "data science" }), pool);
    expect(r.results.map((x) => x.name)).toEqual(["Complet", "Moyen", "Partiel"]);
    expect(r.results.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it("compte la filière d'études, mais pas au point de remplacer les compétences", () => {
    const pool = [
      applicant(1, "Bonne filière", ["python"], { fieldOfStudy: "Science des données" }),
      applicant(2, "Autre filière", ["python"], { fieldOfStudy: "Génie civil" }),
    ];
    const r = rankApplicants(profileFor({ field: "data science" }), pool);
    expect(r.results[0].name).toBe("Bonne filière");
    expect(r.results[0].matched).toContain("filière Data Science");
    expect(r.results[1].missing).toContain("filière Data Science");
  });

  it("nomme les critères couverts et les critères requis manquants", () => {
    const pool = [applicant(1, "A", ["python"], { fieldOfStudy: "Data Science" })];
    const [row] = rankApplicants(profileFor({ field: "data science" }), pool).results;
    expect(row.matched).toEqual(expect.arrayContaining(["python", "filière Data Science"]));
    expect(row.missing).toEqual(["data science"]);
  });

  it("écarte les candidats qui ne couvrent AUCUN critère", () => {
    const pool = [
      applicant(1, "Hors sujet", ["hr"], { fieldOfStudy: "RH" }),
      applicant(2, "Pertinent", ["python"]),
    ];
    const r = rankApplicants(profileFor({ field: "data science" }), pool);
    expect(r.results.map((x) => x.name)).toEqual(["Pertinent"]);
    expect(r.evaluated).toBe(2);
  });

  it("renvoie une liste vide plutôt que du bruit", () => {
    const pool = [applicant(1, "X", ["hr"], { fieldOfStudy: "RH" })];
    expect(rankApplicants(profileFor({ field: "data science" }), pool).results).toEqual([]);
  });

  it("garde la meilleure candidature d'un même candidat", () => {
    const pool = [
      applicant(7, "Double", ["python"]),
      applicant(7, "Double", ["python", "data science", "sql"]),
    ];
    const r = rankApplicants(profileFor({ field: "data science" }), pool);
    expect(r.results).toHaveLength(1);
    expect(r.evaluated).toBe(1);
    expect(r.results[0].missing).toEqual([]);
  });

  it("départage à score égal par le niveau d'études puis l'expérience", () => {
    const skills = ["python", "data science", "sql"];
    const pool = [
      applicant(1, "Bac3", skills, { educationLevel: "Bac+3", yearsExperience: 9 }),
      applicant(2, "Bac5-peu", skills, { educationLevel: "Bac+5", yearsExperience: 0 }),
      applicant(3, "Bac5-plus", skills, { educationLevel: "Bac+5", yearsExperience: 2 }),
    ];
    // minEducation « Bac+3 » : les trois ont une adéquation formation de 1.
    const p = profileFor({ field: "data science", minEducationLevel: "Bac+3" });
    expect(rankApplicants(p, pool).results.map((x) => x.name)).toEqual([
      "Bac5-plus",
      "Bac5-peu",
      "Bac3",
    ]);
  });

  it("respecte top_k", () => {
    const pool = Array.from({ length: 12 }, (_, i) => applicant(i + 1, `C${i}`, ["python"]));
    expect(rankApplicants(profileFor({ field: "data science" }), pool, 3).results).toHaveLength(3);
  });

  it("ne laisse sortir AUCUNE donnée personnelle hors évaluation", () => {
    const pool = [applicant(1, "A", ["python", "data science"])];
    const [row] = rankApplicants(profileFor({ field: "data science" }), pool).results;
    const keys = Object.keys(row);
    for (const forbidden of ["email", "phone", "cv_text", "age", "gender", "birth_date"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys).not.toContain("eduRank"); // champ interne de tri
  });

  it("donne le même classement qu'Affectation IA pour une offre précise", () => {
    const pool = [
      applicant(1, "Auto", ["automation"], { educationLevel: "Bac+3" }),
      applicant(2, "Auto+Maint", ["automation", "maintenance"], { educationLevel: "Bac+3" }),
    ];
    const r = rankApplicants(profileFor({ offer: "Stage Automatisme & GMAO" }), pool);
    expect(r.results[0].name).toBe("Auto+Maint");
    // Couverture complète, mais les compétences extraites sont stockées au poids
    // 0,9 : skillOverlap plafonne donc à 90 %, et 0,7 × 0,9 + 0,3 × 1 = 0,93.
    // C'est le score que donne compositeScore sur la page Affectation IA.
    expect(r.results[0].skills_coverage).toBe(0.9);
    expect(r.results[0].score).toBe(0.93);
  });
});

// ---- Pagination ---------------------------------------------------------------

describe("fetchAllPages", () => {
  it("franchit le plafond de 1 000 lignes de PostgREST", async () => {
    const total = 2345;
    const calls: [number, number][] = [];
    const rows = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      const data = Array.from(
        { length: Math.max(0, Math.min(to, total - 1) - from + 1) },
        (_, i) => from + i,
      );
      return { data, error: null };
    });
    expect(rows).toHaveLength(total);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("s'arrête sur une page exactement pleine suivie d'une page vide", async () => {
    let n = 0;
    const rows = await fetchAllPages<number>(async () => {
      n++;
      return { data: n === 1 ? Array(1000).fill(0) : [], error: null };
    });
    expect(rows).toHaveLength(1000);
    expect(n).toBe(2);
  });

  it("remonte l'erreur de la base", async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });
});
