import { useState } from "react";
import { FunnelIcon, CloseIcon, ChevronDown } from "./icons";
import FilterToggle from "./FilterToggle";
import { INFERENCE_PROVIDERS, USE_CASES } from "../data/models";

export interface FilterState {
  toggles: { free: boolean; partner: boolean; download: boolean };
  useCases: string[];
  providers: string[];
}

export interface FilterCounts {
  free: number;
  partner: number;
  download: number;
  useCases: Record<string, number>;
  providers: Record<string, number>;
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="group flex cursor-pointer items-center justify-between py-1.5">
      <span className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="h-4 w-4 rounded border-nv-border bg-nv-elevated"
        />
        <span className="text-[15px] text-nv-text-secondary group-hover:text-nv-text">{label}</span>
      </span>
      <span className="text-[13px] font-medium text-nv-text-muted">{count}</span>
    </label>
  );
}

function Group({
  title,
  children,
  collapsible = false,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-nv-border px-5 py-4">
      <button
        type="button"
        onClick={() => collapsible && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between ${collapsible ? "" : "cursor-default"}`}
      >
        <span className="text-[13px] font-semibold uppercase tracking-wide text-nv-text-muted">
          {title}
        </span>
        {collapsible && (
          <ChevronDown
            width={16}
            height={16}
            className={`text-nv-text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          />
        )}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export default function FilterSidebar({
  draft,
  setDraft,
  counts,
  onApply,
  onReset,
  onClose,
}: {
  draft: FilterState;
  setDraft: (next: FilterState) => void;
  counts: FilterCounts;
  onApply: () => void;
  onReset: () => void;
  onClose?: () => void;
}) {
  const [showAllUseCases, setShowAllUseCases] = useState(false);
  const visibleUseCases = showAllUseCases ? USE_CASES : USE_CASES.slice(0, 4);

  const setToggle = (key: keyof FilterState["toggles"], value: boolean) =>
    setDraft({ ...draft, toggles: { ...draft.toggles, [key]: value } });

  const toggleArray = (field: "useCases" | "providers", value: string) => {
    const set = new Set(draft[field]);
    set.has(value) ? set.delete(value) : set.add(value);
    setDraft({ ...draft, [field]: [...set] });
  };

  return (
    <aside className="flex h-full w-[290px] shrink-0 flex-col rounded-card border border-nv-border bg-nv-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <span className="flex items-center gap-2 text-[15px] font-semibold text-nv-text">
          <FunnelIcon width={16} height={16} className="text-nv-text-secondary" />
          Filters
        </span>
        <button
          type="button"
          onClick={onClose ?? onReset}
          className="text-nv-text-muted transition-colors hover:text-nv-text"
          aria-label="Close filters"
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Toggle filters */}
        <div className="px-5 pb-3">
          <FilterToggle
            label="Free Endpoint"
            count={counts.free}
            checked={draft.toggles.free}
            onChange={(v) => setToggle("free", v)}
          />
          <FilterToggle
            label="Partner Endpoint"
            count={counts.partner}
            checked={draft.toggles.partner}
            onChange={(v) => setToggle("partner", v)}
          />
          <FilterToggle
            label="Download Available"
            count={counts.download}
            checked={draft.toggles.download}
            onChange={(v) => setToggle("download", v)}
          />
        </div>

        {/* Use Case */}
        <Group title="Use Case">
          {visibleUseCases.map((u) => (
            <CheckRow
              key={u}
              label={u}
              count={counts.useCases[u] ?? 0}
              checked={draft.useCases.includes(u)}
              onChange={() => toggleArray("useCases", u)}
            />
          ))}
          <button
            type="button"
            onClick={() => setShowAllUseCases((s) => !s)}
            className="mt-1 text-[13px] font-medium text-nv-green hover:text-nv-green-hover"
          >
            {showAllUseCases ? "Show less" : "+ Show more"}
          </button>
        </Group>

        {/* Inference Providers */}
        <Group title="Inference Providers" collapsible>
          {INFERENCE_PROVIDERS.map((p) => (
            <CheckRow
              key={p}
              label={p}
              count={counts.providers[p] ?? 0}
              checked={draft.providers.includes(p)}
              onChange={() => toggleArray("providers", p)}
            />
          ))}
        </Group>
      </div>

      {/* Sticky footer */}
      <div className="flex items-center justify-between gap-3 border-t border-nv-border px-5 py-4">
        <button
          type="button"
          onClick={onReset}
          className="text-[14px] font-medium text-nv-text-secondary transition-colors hover:text-nv-text"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onApply}
          className="rounded-input bg-nv-green px-5 py-2 text-[14px] font-semibold text-black transition-colors hover:bg-nv-green-hover"
        >
          Apply
        </button>
      </div>
    </aside>
  );
}
