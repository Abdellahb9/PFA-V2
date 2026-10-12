// Le contexte d'un tour (candidats, documents) doit survivre au tour suivant.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase", () => ({ admin: () => ({}) }));

import { contextNote } from "../../conversations";

describe("contextNote", () => {
  it("rappelle les candidats avec leur identifiant et les documents avec leur page", () => {
    const note = contextNote([
      { type: "candidate", candidate_id: 12, name: "Babtich El Habib" },
      { type: "ranked_candidate", candidate_id: 7, name: "Meriem Bedda" },
      { type: "doc_chunk", source_document: "politique.pdf", chunk_index: 3, page: 2 },
      { type: "doc_chunk", source_document: "politique.pdf", chunk_index: 4, page: 2 },
      { type: "matching_explanation", assignment_id: 5 },
    ]);
    expect(note).toBe(
      "[contexte : candidats — Babtich El Habib (#12), Meriem Bedda (#7), affectation #5 ; " +
        "documents — politique.pdf p.2]",
    );
  });

  it("ne produit rien sans source exploitable", () => {
    expect(contextNote(null)).toBe("");
    expect(contextNote([])).toBe("");
    expect(contextNote([{ type: "inconnu" }, null, 3])).toBe("");
  });

  it("borne la note", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ type: "candidate", candidate_id: i, name: `C${i}` }));
    expect(contextNote(many).match(/#/g)).toHaveLength(6);
  });
});
