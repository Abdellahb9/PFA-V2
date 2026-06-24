// Toggle filter row: label + green switch + right-aligned count.
export default function FilterToggle({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between py-2"
    >
      <span className="flex items-center gap-3">
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            checked ? "bg-nv-green" : "border border-nv-border bg-nv-elevated"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
        <span
          className={`text-[15px] transition-colors ${
            checked ? "text-nv-text" : "text-nv-text-secondary group-hover:text-nv-text"
          }`}
        >
          {label}
        </span>
      </span>
      <span className="text-[13px] font-medium text-nv-text-muted">{count}</span>
    </button>
  );
}
