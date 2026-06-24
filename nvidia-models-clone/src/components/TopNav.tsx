import { NvidiaMark, SearchIcon, ArrowUpRight } from "./icons";

const LINKS = [
  { label: "Explore", active: false, external: false },
  { label: "Models", active: true, external: false },
  { label: "Skills", active: false, external: false },
  { label: "Blueprints", active: false, external: false },
  { label: "GPUs", active: false, external: false },
  { label: "Docs", active: false, external: true },
];

export default function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-nv-border bg-nv-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-container items-center gap-6 px-6 lg:px-12">
        {/* Logo */}
        <a href="#" className="flex shrink-0 items-center gap-2">
          <NvidiaMark />
          <span className="text-[17px] font-bold tracking-tight text-nv-text">NVIDIA</span>
        </a>

        {/* Primary links */}
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href="#"
              className={`relative flex items-center gap-1 px-3 py-2 text-[15px] font-medium transition-colors ${
                l.active ? "text-nv-text" : "text-nv-text-secondary hover:text-nv-text"
              }`}
            >
              {l.label}
              {l.external && <ArrowUpRight width={13} height={13} className="opacity-70" />}
              {l.active && (
                <span className="absolute inset-x-2 -bottom-[1px] h-0.5 rounded-full bg-nv-green" />
              )}
            </a>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-3">
          <label className="hidden items-center gap-2 rounded-input border border-nv-border bg-nv-panel px-3 py-2 text-nv-text-muted transition-colors focus-within:border-nv-border-strong sm:flex">
            <SearchIcon width={16} height={16} />
            <input
              className="w-40 bg-transparent text-[14px] text-nv-text placeholder:text-nv-text-muted focus:outline-none lg:w-52"
              placeholder="Search"
            />
            <kbd className="rounded border border-nv-border bg-nv-elevated px-1.5 py-0.5 text-[11px] font-medium text-nv-text-muted">
              Ctrl K
            </kbd>
          </label>
          <button className="rounded-input bg-white px-4 py-2 text-[14px] font-semibold text-black transition-colors hover:bg-nv-text-secondary">
            Login
          </button>
        </div>
      </div>
    </header>
  );
}
