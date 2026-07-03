import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import KpiCard from "@/components/KpiCard";

describe("KpiCard", () => {
  it("renders the title, value and suffix", () => {
    render(<KpiCard title="Candidatures" value={42} suffix="%" />);
    expect(screen.getByText("Candidatures")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  it("renders string values as-is", () => {
    render(<KpiCard title="Statut" value="En cours" />);
    expect(screen.getByText("En cours")).toBeInTheDocument();
  });
});
