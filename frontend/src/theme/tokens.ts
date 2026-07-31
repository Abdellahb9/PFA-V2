// Single source of truth for brand, semantic and chart colors.
// The categorical chart palettes were validated (lightness band, chroma floor,
// CVD separation ΔE ≥ 12, ≥ 3:1 contrast vs surface) for each mode — change
// them as a set, not slot by slot.
import type { ThemeMode } from "./ThemeProvider";

export const BRAND = "#76B900"; // NVIDIA green
export const BRAND_HOVER = "#8FD400";

// Glass surfaces (--glass-surface / --glass-elevated / --glass-solid …) live in
// index.css, not here: backdrop-filter can't be expressed as an AntD token, and
// keeping one copy avoids the CSS and TS values drifting apart. Read them from
// TS with var(--glass-*) — see components/charts/ChartTooltip.tsx.

// One value per semantic role and mode (UI accents: progress bars, icons, tags).
export const semanticColors = {
  light: {
    success: "#5F9400",
    info: "#2A78D6",
    warning: "#C98300",
    danger: "#D9363E",
    purple: "#7C5CDB",
  },
  dark: {
    success: "#8FD400",
    info: "#5B9BE6",
    warning: "#E3A008",
    danger: "#F06B6A",
    purple: "#9D82E8",
  },
} as const;

export type SemanticColorKey = keyof (typeof semanticColors)["light"];

// Categorical palette — fixed hue order (green, blue, amber, purple, teal,
// rose, indigo, orange), assigned in sequence, never cycled.
export const chartPalettes: Record<ThemeMode, readonly string[]> = {
  light: ["#5F9400", "#2A78D6", "#C98300", "#7C5CDB", "#0E9F8C", "#E34948", "#5B6BD5", "#EB6834"],
  dark: ["#69A500", "#3D84E6", "#BF8400", "#8F6FE3", "#109783", "#E85D5C", "#6E7FE0", "#DE5F28"],
};

// Recessive chart chrome per mode (grid hairlines, axis text, tooltip surface).
export const chartSurfaces = {
  light: {
    grid: "#e5e9ef",
    axisText: "#5f6b7a",
    tooltipBg: "#ffffff",
    tooltipBorder: "#e5e9ef",
    surface: "#ffffff",
  },
  dark: {
    grid: "#2a2a2a",
    axisText: "#9aa4ae",
    tooltipBg: "#1f1f1f",
    tooltipBorder: "#2f2f2f",
    surface: "#161616",
  },
} as const;
