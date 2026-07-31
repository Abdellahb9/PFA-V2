// The two NVIDIA "Build" themes (same green accent), switchable at runtime.
import { theme } from "antd";
import type { ThemeConfig } from "antd";
import { BRAND, BRAND_HOVER, semanticColors } from "./tokens";

const shared = {
  colorPrimary: BRAND,
  colorLink: BRAND,
  colorLinkHover: BRAND_HOVER,
  borderRadius: 8,
  fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...shared,
    colorInfo: semanticColors.dark.info,
    colorWarning: semanticColors.dark.warning,
    colorError: semanticColors.dark.danger,
    colorBgBase: "#0A0A0A",
    colorBgContainer: "#161616",
    colorBgElevated: "#1F1F1F",
    colorBorder: "#2A2A2A",
    colorBorderSecondary: "#2A2A2A",
    colorText: "#FFFFFF",
    colorTextSecondary: "#B4B4B4",
  },
  components: {
    Layout: { siderBg: "rgba(16,16,18,0.85)", headerBg: "transparent", bodyBg: "transparent" },
    Menu: {
      darkItemBg: "transparent",
      darkSubMenuItemBg: "transparent",
      darkItemSelectedBg: "rgba(118,185,0,0.16)",
      darkItemSelectedColor: BRAND,
    },
    Card: { colorBgContainer: "#161616", colorBorderSecondary: "#2A2A2A" },
    // Translucent so tables/inputs don't paint solid slabs inside glass cards
    // (the card itself is the glass layer; these only tint what shows through).
    Table: {
      headerBg: "rgba(255,255,255,0.04)",
      rowHoverBg: "rgba(255,255,255,0.06)",
      colorBgContainer: "transparent",
    },
    Button: { primaryColor: "#0A0A0A", fontWeight: 600 },
    Input: { colorBgContainer: "rgba(255,255,255,0.06)" },
    InputNumber: { colorBgContainer: "rgba(255,255,255,0.06)" },
    Select: { colorBgContainer: "rgba(255,255,255,0.06)", optionSelectedBg: "rgba(118,185,0,0.16)" },
    Modal: { contentBg: "#161616", headerBg: "#161616" },
    Drawer: { colorBgElevated: "#161616" },
  },
};

export const lightTheme: ThemeConfig = {
  token: {
    ...shared,
    colorInfo: semanticColors.light.info,
    colorWarning: semanticColors.light.warning,
    colorError: semanticColors.light.danger,
    colorBgLayout: "#f4f6f8",
    colorBorderSecondary: "#eceff3",
  },
  components: {
    Layout: { headerBg: "transparent", bodyBg: "transparent", siderBg: "#ffffff" },
    Menu: { itemSelectedBg: "rgba(118,185,0,0.12)", itemSelectedColor: "#5a8f00" },
    Button: { primaryColor: "#0A0A0A", fontWeight: 600 },
    Card: { colorBorderSecondary: "#eceff3" },
    // Same rationale as dark: let the glass card show through the table.
    Table: {
      headerBg: "rgba(15,23,42,0.04)",
      rowHoverBg: "rgba(15,23,42,0.03)",
      colorBgContainer: "transparent",
    },
  },
};

// Canvas base + mesh intensity per mode (used by the BackgroundLayer).
export const modeVisuals = {
  dark: {
    base: "#0A0A0A",
    canvasOpacity: 1,
    glow: "radial-gradient(130% 78% at 50% 100%, rgba(118,185,0,0.34) 0%, rgba(118,185,0,0.16) 40%, transparent 76%)",
    nodeAlpha: 0.95,
    lineAlpha: 0.3,
    triAlpha: 0.42,
  },
  light: {
    base: "#f4f6f8",
    canvasOpacity: 0.9,
    glow: "radial-gradient(130% 78% at 50% 100%, rgba(118,185,0,0.22) 0%, rgba(118,185,0,0.1) 40%, transparent 76%)",
    nodeAlpha: 0.9,
    lineAlpha: 0.3,
    triAlpha: 0.32,
  },
} as const;
