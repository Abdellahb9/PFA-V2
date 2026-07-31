// KPI stat tile: uppercase label, large tabular value, tinted icon chip,
// optional trend sparkline or slim progress meter.
import { Card, Progress, theme, Typography } from "antd";
import type { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import useChartTheme from "@/theme/useChartTheme";
import type { SemanticColorKey } from "@/theme/tokens";

interface Props {
  title: string;
  value: number | string;
  suffix?: string;
  precision?: number;
  icon?: ReactNode;
  /** Semantic accent for the icon chip / meter (default: brand green). */
  accent?: SemanticColorKey | "brand";
  /** Small trend series rendered as a sparkline under the value. */
  spark?: number[];
  /** 0–100: renders a slim progress meter instead of a sparkline. */
  progress?: number;
}

export default function KpiCard({
  title,
  value,
  suffix,
  precision,
  icon,
  accent = "brand",
  spark,
  progress,
}: Props) {
  const { token } = theme.useToken();
  const chart = useChartTheme();
  const accentColor = accent === "brand" ? chart.brand : chart.semantic[accent];

  const formatted =
    typeof value === "number"
      ? value.toLocaleString("fr-FR", {
          minimumFractionDigits: precision ?? 0,
          maximumFractionDigits: precision ?? 0,
        })
      : value;

  const sparkData = spark?.map((v, i) => ({ i, v }));
  const sparkId = `kpi-spark-${title.replace(/\W/g, "")}`;

  return (
    <Card styles={{ body: { padding: 20 } }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            {title}
          </Typography.Text>
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              lineHeight: 1.25,
              color: token.colorText,
              whiteSpace: "nowrap",
            }}
          >
            {formatted}
            {suffix && (
              <span style={{ fontSize: 16, fontWeight: 600, color: token.colorTextSecondary, marginLeft: 4 }}>
                {suffix}
              </span>
            )}
          </div>
        </div>
        {icon && (
          <div
            aria-hidden
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              color: accentColor,
              background: `${accentColor}1F`,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
      </div>

      {sparkData && sparkData.length > 1 && (
        <div style={{ height: 36, marginTop: 10 }}>
          <ResponsiveContainer>
            <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={accentColor}
                strokeWidth={2}
                fill={`url(#${sparkId})`}
                isAnimationActive={chart.animate}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {progress != null && (
        <Progress
          percent={Math.round(progress)}
          showInfo={false}
          strokeColor={accentColor}
          size={{ height: 6 }}
          style={{ marginTop: 14, marginBottom: 0 }}
        />
      )}
    </Card>
  );
}
