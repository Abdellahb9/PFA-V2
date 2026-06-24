import type { Model } from "../data/models";
import Badge from "./Badge";
import { DownloadIcon, ClockIcon } from "./icons";

const MAX_TAGS = 3;

export default function ModelCard({ model }: { model: Model }) {
  const extraTags = model.tags.length - MAX_TAGS;

  return (
    <article className="group flex flex-col rounded-card border border-nv-border bg-nv-panel p-5 transition-all duration-200 hover:border-nv-border-strong hover:shadow-green-glow">
      {/* Header: logo + name + badges */}
      <div className="flex items-start gap-3">
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[15px] font-bold text-white ${model.logoColor}`}
        >
          {model.provider.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-nv-text-muted">{model.provider}</div>
          <h3 className="truncate text-[22px] font-semibold leading-tight text-nv-text">
            {model.name}
          </h3>
        </div>
      </div>

      {/* Badges */}
      <div className="mt-3 flex flex-wrap gap-2">
        {model.badges.includes("downloadable") && <Badge variant="blue">Downloadable</Badge>}
        {model.badges.includes("free-endpoint") && <Badge variant="purple">Free Endpoint</Badge>}
      </div>

      {/* Description (2 lines) */}
      <p className="mt-3 line-clamp-2 text-[15px] leading-relaxed text-nv-text-secondary">
        {model.description}
      </p>

      {/* Tags */}
      <div className="mt-4 flex flex-wrap gap-2">
        {model.tags.slice(0, MAX_TAGS).map((t) => (
          <span
            key={t}
            className="rounded-full border border-nv-border bg-nv-elevated px-2.5 py-1 text-[13px] font-medium text-nv-text-secondary"
          >
            {t}
          </span>
        ))}
        {extraTags > 0 && (
          <span className="rounded-full border border-nv-border bg-nv-elevated px-2.5 py-1 text-[13px] font-medium text-nv-text-muted">
            +{extraTags}
          </span>
        )}
      </div>

      {/* Metadata row */}
      <div className="mt-5 flex items-center justify-end gap-4 border-t border-nv-border pt-3 text-[13px] font-medium text-nv-text-muted">
        <span className="flex items-center gap-1.5">
          <DownloadIcon width={14} height={14} />
          {model.downloads}
        </span>
        <span className="flex items-center gap-1.5">
          <ClockIcon width={14} height={14} />
          {model.age}
        </span>
      </div>
    </article>
  );
}
