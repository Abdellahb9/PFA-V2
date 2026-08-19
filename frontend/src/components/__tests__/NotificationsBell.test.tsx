import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Candidate } from "@/api/types";

// La cloche lit les candidats via ce hook : on le remplace pour piloter les
// dates d'arrivée sans toucher au réseau.
const candidates = vi.hoisted(() => ({ value: [] as Candidate[] }));
vi.mock("@/api/hooks", () => ({
  useNewCandidates: () => ({ data: candidates.value }),
}));

import NotificationsBell from "@/components/NotificationsBell";

const SEEN_KEY = "candidates-seen-at";
const AVANT = "2026-01-01T10:00:00.000Z";
const REPERE = "2026-02-01T10:00:00.000Z";
const APRES = "2026-03-01T10:00:00.000Z";

const candidate = (id: number, name: string, created_at: string): Candidate =>
  ({
    id,
    first_name: name,
    last_name: "",
    full_name: name,
    email: `${name}@example.ma`,
    years_experience: 0,
    field_of_study: "Informatique",
    created_at,
    skills: [],
    has_embedding: false,
  }) as Candidate;

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <NotificationsBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("NotificationsBell", () => {
  beforeEach(() => {
    localStorage.clear();
    candidates.value = [];
  });

  it("ne compte que les candidats arrivés après la dernière consultation", async () => {
    localStorage.setItem(SEEN_KEY, REPERE);
    candidates.value = [candidate(1, "Ancien", AVANT), candidate(2, "Recent", APRES)];
    mount();
    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("n'annonce rien à la première ouverture, même avec un historique", () => {
    // Sans repère, il est posé à maintenant : l'historique n'est pas signalé.
    candidates.value = [candidate(1, "Ancien", AVANT), candidate(2, "Autre", APRES)];
    mount();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(localStorage.getItem(SEEN_KEY)).toBeTruthy();
  });

  it("liste les candidats et remet le compteur à zéro à l'ouverture", async () => {
    localStorage.setItem(SEEN_KEY, REPERE);
    candidates.value = [candidate(2, "Recent", APRES)];
    mount();
    expect(await screen.findByText("1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText("Recent")).toBeInTheDocument();
    // Ouvrir vaut lecture : le repère avance et le badge disparaît.
    await waitFor(() => expect(screen.queryByText("1")).not.toBeInTheDocument());
    expect(localStorage.getItem(SEEN_KEY)! > REPERE).toBe(true);
  });

  it("montre les plus récents en premier", async () => {
    localStorage.setItem(SEEN_KEY, REPERE);
    candidates.value = [candidate(1, "Ancien", AVANT), candidate(2, "Recent", APRES)];
    mount();
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    const names = await screen.findAllByText(/Ancien|Recent/);
    expect(names[0].textContent).toContain("Recent");
  });

  it("reste utilisable quand aucun candidat n'existe", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText("Aucun candidat pour l'instant")).toBeInTheDocument();
  });
});
