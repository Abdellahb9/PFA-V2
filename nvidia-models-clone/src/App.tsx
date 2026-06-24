import { useEffect, useMemo, useState } from "react";
import TopNav from "./components/TopNav";
import PageHeader from "./components/PageHeader";
import Tabs, { type TabKey } from "./components/Tabs";
import FilterSidebar, {
  type FilterCounts,
  type FilterState,
} from "./components/FilterSidebar";
import ResultsArea, { type SortKey } from "./components/ResultsArea";
import { CloseIcon } from "./components/icons";
import { INFERENCE_PROVIDERS, MODELS, USE_CASES } from "./data/models";

const EMPTY_FILTERS: FilterState = {
  toggles: { free: false, partner: false, download: false },
  useCases: [],
  providers: [],
};

export default function App() {
  const [tab, setTab] = useState<TabKey>("optimized");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("downloads");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(9);
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [mobileFilters, setMobileFilters] = useState(false);

  // Sidebar counts are computed over the full catalog.
  const counts: FilterCounts = useMemo(
    () => ({
      free: MODELS.filter((m) => m.badges.includes("free-endpoint")).length,
      partner: MODELS.filter((m) => m.partnerEndpoint).length,
      download: MODELS.filter((m) => m.badges.includes("downloadable")).length,
      useCases: Object.fromEntries(
        USE_CASES.map((u) => [u, MODELS.filter((m) => m.useCases.includes(u)).length]),
      ),
      providers: Object.fromEntries(
        INFERENCE_PROVIDERS.map((p) => [p, MODELS.filter((m) => m.providers.includes(p)).length]),
      ),
    }),
    [],
  );

  const filtered = useMemo(() => {
    // "Launch from Hugging Face" tab only surfaces downloadable models.
    let list = tab === "hf" ? MODELS.filter((m) => m.badges.includes("downloadable")) : MODELS;

    if (applied.toggles.free) list = list.filter((m) => m.badges.includes("free-endpoint"));
    if (applied.toggles.download) list = list.filter((m) => m.badges.includes("downloadable"));
    if (applied.toggles.partner) list = list.filter((m) => m.partnerEndpoint);
    if (applied.useCases.length)
      list = list.filter((m) => m.useCases.some((u) => applied.useCases.includes(u)));
    if (applied.providers.length)
      list = list.filter((m) => m.providers.some((p) => applied.providers.includes(p)));

    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter((m) =>
        `${m.provider} ${m.name} ${m.description} ${m.tags.join(" ")}`.toLowerCase().includes(q),
      );

    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "newest") return a.ageDays - b.ageDays;
      return b.downloadsNum - a.downloadsNum;
    });
  }, [tab, applied, query, sort]);

  // Any change to the result set resets to the first page.
  useEffect(() => {
    setPage(1);
  }, [tab, applied, query, sort, perPage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageModels = filtered.slice((page - 1) * perPage, page * perPage);

  const onApply = () => {
    setApplied(draft);
    setMobileFilters(false);
  };
  const onReset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  return (
    <div className="nv-canvas min-h-screen">
      <TopNav />

      <main className="mx-auto max-w-container px-6 py-10 lg:px-12">
        <PageHeader />

        <div className="mt-8">
          <Tabs active={tab} onChange={setTab} />
        </div>

        <div className="mt-8 flex gap-8">
          {/* Desktop sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-20 h-[calc(100vh-7rem)]">
              <FilterSidebar
                draft={draft}
                setDraft={setDraft}
                counts={counts}
                onApply={onApply}
                onReset={onReset}
              />
            </div>
          </div>

          <ResultsArea
            total={filtered.length}
            pageModels={pageModels}
            query={query}
            onQuery={setQuery}
            sort={sort}
            onSort={setSort}
            page={page}
            totalPages={totalPages}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
            onOpenFilters={() => setMobileFilters(true)}
          />
        </div>
      </main>

      {/* Mobile filter drawer */}
      {mobileFilters && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileFilters(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[320px] max-w-[88vw] flex-col bg-nv-bg p-3">
            <button
              onClick={() => setMobileFilters(false)}
              className="mb-2 ml-auto flex items-center gap-1 text-[14px] text-nv-text-secondary hover:text-nv-text"
            >
              Close <CloseIcon width={16} height={16} />
            </button>
            <div className="min-h-0 flex-1">
              <FilterSidebar
                draft={draft}
                setDraft={setDraft}
                counts={counts}
                onApply={onApply}
                onReset={onReset}
                onClose={() => setMobileFilters(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
