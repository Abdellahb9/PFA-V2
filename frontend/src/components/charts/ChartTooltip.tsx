// Shared Recharts tooltip: elevated surface, series dot + label, tabular value.
// Pass it to <Tooltip content={<ChartTooltip chart={chart} />} />.
import type { ChartTheme } from "@/theme/useChartTheme";

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { fill?: string };
}

interface Props {
  chart: ChartTheme;
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  /** Optional value formatter (e.g. percentages). */
  formatter?: (value: number | string) => string;
}

export default function ChartTooltip({ chart, active, label, payload, formatter }: Props) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        // Glass vars come from index.css (see the liquid-glass block); the
        // solid token stays as the fallback where backdrop-filter is missing.
        background: `var(--glass-elevated, ${chart.tooltip.bg})`,
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        border: `1px solid ${chart.tooltip.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "var(--glass-shadow, 0 4px 16px rgba(0,0,0,0.12))",
        fontSize: 12,
        lineHeight: 1.7,
        minWidth: 120,
      }}
    >
      {label != null && label !== "" && (
        <div style={{ color: chart.tooltip.textSecondary, marginBottom: 2 }}>{label}</div>
      )}
      {payload.map((entry, i) => {
        const dot = entry.color ?? entry.payload?.fill ?? chart.brand;
        const value = entry.value ?? "";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: dot,
                flexShrink: 0,
              }}
            />
            <span style={{ color: chart.tooltip.textSecondary }}>{entry.name}</span>
            <span
              style={{
                marginLeft: "auto",
                color: chart.tooltip.text,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatter ? formatter(value) : value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
