// Extraction de repères depuis le texte brut d'un CV.
//
// L'expérience était lue par un « (\d+)\s*ans » sans contexte, puis réduite par
// Math.max : un CV s'ouvrant sur « MERIEM BEDDA 22 ans » créditait la candidate
// de 22 années d'expérience. Le chiffre remontait ensuite jusqu'à l'assistant,
// qui le présentait comme un fait.
import { describe, expect, it } from "vitest";
import { regexHints } from "./cv";

describe("regexHints — années d'expérience", () => {
  it("ne prend pas un âge pour de l'expérience", () => {
    const cv =
      "MERIEM BEDDA 22 ans CONTACT +212 606961481 bdmery5@gmail.com " +
      "EDUCATION -Bac en physique et chimie 2019-2020 -Bac en SVT 2020-2021";
    expect(regexHints(cv).yearsExperience).toBe(0);
  });

  it("lit l'expérience quand le mot la qualifie, avant ou après", () => {
    expect(regexHints("5 ans d'expérience en développement web.").yearsExperience).toBe(5);
    expect(regexHints("Expérience : 3 ans sur des projets Python.").yearsExperience).toBe(3);
    expect(regexHints("4 years of experience in data engineering.").yearsExperience).toBe(4);
  });

  it("distingue l'âge de l'expérience dans le même CV", () => {
    expect(regexHints("AHMED 30 ans. 2 ans d'expérience en réseau.").yearsExperience).toBe(2);
  });

  it("ignore une année de diplôme ou une durée de stage", () => {
    expect(regexHints("Diplôme obtenu en 2021. Stage de 6 mois.").yearsExperience).toBe(0);
  });

  it("écarte les valeurs invraisemblables", () => {
    expect(regexHints("2021 ans d'expérience").yearsExperience).toBe(0);
  });

  it("renvoie 0 plutôt que NaN sur un CV sans mention", () => {
    expect(regexHints("Développeur. Compétences : Python, SQL.").yearsExperience).toBe(0);
  });
});

describe("regexHints — autres repères", () => {
  it("extrait email et téléphone", () => {
    const h = regexHints("Contact : bdmery5@gmail.com +212 606961481");
    expect(h.email).toBe("bdmery5@gmail.com");
    expect(h.phone).toContain("212");
  });

  it("reconnaît un établissement marocain par acronyme ou libellé", () => {
    expect(regexHints("Diplômé de l'ENSIAS, Rabat").university).toContain("ENSIAS");
    expect(regexHints("Université Mohammed V de Rabat").university).toMatch(/[Uu]niversit/);
  });

  it("renvoie null quand rien n'est trouvable", () => {
    const h = regexHints("Texte sans coordonnées ni école.");
    expect(h.email).toBeNull();
    expect(h.university).toBeNull();
  });
});
