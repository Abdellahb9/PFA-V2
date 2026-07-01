// The two NVIDIA "Build" themes (same green accent), switchable at runtime.
import { theme } from "antd";
import type { ThemeConfig } from "antd";

const shared = {
  colorPrimary: "#76B900",
  colorInfo: "#76B900",
  colorLink: "#76B900",
  colorLinkHover: "#8FD400",
  borderRadius: 8,
  fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...shared,
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
      darkItemSelectedColor: "#76B900",
    },
    Card: { colorBgContainer: "#161616", colorBorderSecondary: "#2A2A2A" },
    Table: { headerBg: "#1F1F1F", rowHoverBg: "#1F1F1F", colorBgContainer: "#161616" },
    Button: { primaryColor: "#0A0A0A", fontWeight: 600 },
    Input: { colorBgContainer: "#1F1F1F" },
    InputNumber: { colorBgContainer: "#1F1F1F" },
    Select: { colorBgContainer: "#1F1F1F", optionSelectedBg: "rgba(118,185,0,0.16)" },
    Modal: { contentBg: "#161616", headerBg: "#161616" },
    Drawer: { colorBgElevated: "#161616" },
  },
};

export const lightTheme: ThemeConfig = {
  token: {
    ...shared,
    colorBgLayout: "#f4f6f8",
    colorBorderSecondary: "#eceff3",
  },
  components: {
    Layout: { headerBg: "transparent", bodyBg: "transparent", siderBg: "#ffffff" },
    Menu: { itemSelectedBg: "rgba(118,185,0,0.12)", itemSelectedColor: "#5a8f00" },
    Button: { primaryColor: "#0A0A0A", fontWeight: 600 },
    Card: { colorBorderSecondary: "#eceff3" },
  },
};

// Canvas base + mesh intensity per mode (used by the BackgroundLayer).
export const modeVisuals = {
  dark: {
    base: "#0A0A0A",
    canvasOpacity: 0.9,
    glow: "radial-gradient(120% 65% at 50% 100%, rgba(118,185,0,0.22) 0%, rgba(118,185,0,0.09) 38%, transparent 72%)",
    nodeAlpha: 0.75,
    lineAlpha: 0.2,
    triAlpha: 0.3,
  },
  light: {
    base: "#f4f6f8",
    canvasOpacity: 0.7,
    glow: "radial-gradient(120% 65% at 50% 100%, rgba(118,185,0,0.13) 0%, rgba(118,185,0,0.05) 38%, transparent 72%)",
    nodeAlpha: 0.6,
    lineAlpha: 0.16,
    triAlpha: 0.2,
  },
} as const;
