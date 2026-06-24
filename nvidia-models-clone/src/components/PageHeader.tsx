import { HexagonIcon } from "./icons";

export default function PageHeader() {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-1 grid h-12 w-12 shrink-0 place-items-center rounded-card border border-nv-border bg-nv-panel text-nv-green">
        <HexagonIcon width={24} height={24} />
      </div>
      <div>
        <h1 className="text-[40px] font-bold leading-none tracking-tightest text-nv-text">
          Models
        </h1>
        <p className="mt-3 max-w-2xl text-[18px] text-nv-text-secondary">
          Build with the latest accelerated models — run optimized endpoints or download to deploy
          anywhere.
        </p>
      </div>
    </div>
  );
}
