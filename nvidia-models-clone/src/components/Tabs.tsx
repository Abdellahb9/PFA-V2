export type TabKey = "optimized" | "hf";

export default function Tabs({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
}) {
  const tab = (key: TabKey, label: string, beta?: boolean) => {
    const isActive = active === key;
    return (
      <button
        type="button"
        onClick={() => onChange(key)}
        className={`relative flex items-center gap-2 px-1 pb-3 pt-2 text-[15px] font-medium transition-colors ${
          isActive ? "text-nv-green" : "text-nv-text-secondary hover:text-nv-text"
        }`}
      >
        {label}
        {beta && (
          <span className="rounded-full border border-nv-border-strong bg-nv-elevated px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-nv-text-secondary">
            Beta
          </span>
        )}
        {isActive && (
          <span className="absolute inset-x-0 -bottom-[1px] h-0.5 rounded-full bg-nv-green" />
        )}
      </button>
    );
  };

  return (
    <div className="no-scrollbar flex items-center gap-8 overflow-x-auto border-b border-nv-border">
      {tab("optimized", "Optimized by NVIDIA")}
      {tab("hf", "Launch from Hugging Face", true)}
    </div>
  );
}
