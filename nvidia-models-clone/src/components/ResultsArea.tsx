import type { Model } from "../data/models";
import { SearchIcon, ChevronDown, FunnelIcon } from "./icons";
import ModelCard from "./ModelCard";
import Pagination from "./Pagination";

export type SortKey = "downloads" | "newest" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  downloads: "Most downloaded",
  newest: "Newest",
  name: "Name (A–Z)",
};

export default function ResultsArea({
  total,
  pageModels,
  query,
  onQuery,
  sort,
  onSort,
  page,
  totalPages,
  perPage,
  onPage,
  onPerPage,
  onOpenFilters,
}: {
  total: number;
  pageModels: Model[];
  query: string;
  onQuery: (q: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  page: number;
  totalPages: number;
  perPage: number;
  onPage: (p: number) => void;
  onPerPage: (n: number) => void;
  onOpenFilters: () => void;
}) {
  return (
    <section className="min-w-0 flex-1">
      {/* Top controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onOpenFilters}
          className="flex items-center gap-2 rounded-input border border-nv-border bg-nv-panel px-3 py-2 text-[14px] text-nv-text-secondary hover:text-nv-text lg:hidden"
        >
          <FunnelIcon width={16} height={16} />
          Filters
        </button>

        <span className="text-[15px] font-medium text-nv-text">
          {total} model{total === 1 ? "" : "s"}
        </span>

        <label className="order-last flex w-full items-center gap-2 rounded-input border border-nv-border bg-nv-panel px-3 py-2 transition-colors focus-within:border-nv-border-strong md:order-none md:mx-auto md:w-auto md:min-w-[320px]">
          <SearchIcon width={16} height={16} className="text-nv-text-muted" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search models"
            className="w-full bg-transparent text-[14px] text-nv-text placeholder:text-nv-text-muted focus:outline-none"
          />
        </label>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <span className="text-[14px] text-nv-text-muted">Sort By</span>
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value as SortKey)}
              className="appearance-none rounded-input border border-nv-border bg-nv-panel py-2 pl-3 pr-9 text-[14px] text-nv-text focus:border-nv-border-strong focus:outline-none"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
            <ChevronDown
              width={15}
              height={15}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-nv-text-muted"
            />
          </div>
        </div>
      </div>

      {/* Cards grid */}
      {pageModels.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {pageModels.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      ) : (
        <div className="mt-16 grid place-items-center rounded-card border border-dashed border-nv-border py-20 text-center">
          <p className="text-[16px] text-nv-text-secondary">No models match your filters.</p>
          <p className="mt-1 text-[14px] text-nv-text-muted">Try resetting or broadening them.</p>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          perPage={perPage}
          onPage={onPage}
          onPerPage={onPerPage}
        />
      )}
    </section>
  );
}
