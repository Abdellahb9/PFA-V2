import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown } from "./icons";

const PER_PAGE_OPTIONS = [6, 9, 12, 24];

export default function Pagination({
  page,
  totalPages,
  perPage,
  onPage,
  onPerPage,
}: {
  page: number;
  totalPages: number;
  perPage: number;
  onPage: (p: number) => void;
  onPerPage: (n: number) => void;
}) {
  const go = (p: number) => onPage(Math.min(Math.max(1, p), totalPages));
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  const navBtn =
    "grid h-8 w-8 place-items-center rounded-input border border-nv-border bg-nv-panel text-nv-text-secondary transition-colors hover:border-nv-border-strong hover:text-nv-text disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-[14px] text-nv-text-secondary">
        <span>Items per page</span>
        <div className="relative">
          <select
            value={perPage}
            onChange={(e) => onPerPage(Number(e.target.value))}
            className="appearance-none rounded-input border border-nv-border bg-nv-panel py-1.5 pl-3 pr-8 text-[14px] text-nv-text focus:border-nv-border-strong focus:outline-none"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <ChevronDown
            width={14}
            height={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-nv-text-muted"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={navBtn} onClick={() => go(1)} disabled={page === 1} aria-label="First page">
          <ChevronsLeft width={15} height={15} />
        </button>
        <button
          className={navBtn}
          onClick={() => go(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
        >
          <ChevronLeft width={15} height={15} />
        </button>

        {pages.map((p) => (
          <button
            key={p}
            onClick={() => go(p)}
            className={`grid h-8 min-w-8 place-items-center rounded-input border px-2 text-[14px] font-medium transition-colors ${
              p === page
                ? "border-nv-green bg-nv-green/10 text-nv-green"
                : "border-nv-border bg-nv-panel text-nv-text-secondary hover:border-nv-border-strong hover:text-nv-text"
            }`}
          >
            {p}
          </button>
        ))}

        <button
          className={navBtn}
          onClick={() => go(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
        >
          <ChevronRight width={15} height={15} />
        </button>
        <button
          className={navBtn}
          onClick={() => go(totalPages)}
          disabled={page === totalPages}
          aria-label="Last page"
        >
          <ChevronsRight width={15} height={15} />
        </button>

        <span className="ml-2 text-[14px] text-nv-text-muted">of {totalPages} pages</span>
      </div>
    </div>
  );
}
