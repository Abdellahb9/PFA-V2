// Mode-aware styling for every Recharts chart: palette, grid/axis chrome,
// tooltip surface and animation flag (honours prefers-reduced-motion).
import { useMemo } from "react";
import { theme } from "antd";
import { useThemeMode } from "./ThemeProvider";
import { BRAND, BRAND_HOVER, chartPalettes, chartSurfaces, semanticColors } from "./tokens";

export default function useChartTheme() {
  const { mode } = useThemeMode();
  const { token } = theme.useToken();

  return useMemo(() => {
    const surfaces = chartSurfaces[mode];
    const reducedMotion =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    return {
      mode,
      brand: mode === "dark" ? BRAND_HOVER : BRAND,
      palette: chartPalettes[mode],
      semantic: semanticColors[mode],
      animate: !reducedMotion,
      // Solid hairline grid, horizontal lines only — recessive by design.
      gridProps: { stroke: surfaces.grid, strokeWidth: 1, vertical: false as const },
      axisTick: { fill: surfaces.axisText, fontSize: 12 },
      // Borderless axes: the grid carries the scale.
      axisProps: { axisLine: false as const, tickLine: false as const },
      cursorFill: mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(15,23,42,0.04)",
      tooltip: {
        bg: surfaces.tooltipBg,
        border: surfaces.tooltipBorder,
        text: token.colorText,
        textSecondary: token.colorTextSecondary,
      },
      // SVG strokes (donut slice gaps, activeDot rims) can't be blurred, and a
      // translucent stroke over a chart reads as dirt — keep them solid even
      // though the surrounding card is glass.
      surfaceSolid: surfaces.surface,
    };
  }, [mode, token.colorText, token.colorTextSecondary]);
}

export type ChartTheme = ReturnType<typeof useChartTheme>;
