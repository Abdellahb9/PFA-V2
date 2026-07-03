import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "@/components/ErrorBoundary";

const RELOAD_FLAG = "phos_chunk_reloaded";

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React + componentDidCatch both log the caught error; keep output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>tout-va-bien</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("tout-va-bien")).toBeInTheDocument();
  });

  it("shows the error screen with a reload button on a render error", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Une erreur est survenue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recharger" })).toBeInTheDocument();
  });

  it("auto-reloads once on a stale-chunk error, then falls back to the error UI", () => {
    const chunkError = new Error("Failed to fetch dynamically imported module: /chunk.js");
    // First occurrence: no flag yet -> reload path.
    expect(ErrorBoundary.getDerivedStateFromError(chunkError).reloading).toBe(true);
    // Already reloaded once -> show the error UI instead of looping.
    sessionStorage.setItem(RELOAD_FLAG, "1");
    expect(ErrorBoundary.getDerivedStateFromError(chunkError).reloading).toBe(false);
    // A non-chunk error never triggers the reload path.
    expect(ErrorBoundary.getDerivedStateFromError(new Error("boom")).reloading).toBe(false);
  });
});
