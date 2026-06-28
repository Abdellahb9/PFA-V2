// Application bootstrap: Redux + React Query + Ant Design (French locale).
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, theme } from "antd";
import frFR from "antd/locale/fr_FR";
import "antd/dist/reset.css";
import "dayjs/locale/fr";

import App from "./App";
import { store } from "./store";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// NVIDIA "Build" aesthetic: near-black canvas, single saturated green accent.
const nvidiaTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#76B900",
    colorInfo: "#76B900",
    colorBgBase: "#0A0A0A",
    colorBgContainer: "#161616",
    colorBgElevated: "#1F1F1F",
    colorBorder: "#2A2A2A",
    colorBorderSecondary: "#1F1F1F",
    colorText: "#FFFFFF",
    colorTextSecondary: "#B4B4B4",
    colorTextTertiary: "#6E6E6E",
    colorLink: "#76B900",
    colorLinkHover: "#8FD400",
    borderRadius: 8,
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  components: {
    // Transparent body/header + translucent sider so the fixed BackgroundLayer
    // (constellation) shows through; cards stay opaque panels.
    Layout: {
      siderBg: "rgba(16,16,18,0.8)",
      headerBg: "transparent",
      bodyBg: "transparent",
      triggerBg: "#1F1F1F",
    },
    Menu: {
      darkItemBg: "transparent",
      darkSubMenuItemBg: "transparent",
      darkItemSelectedBg: "rgba(118,185,0,0.16)",
      darkItemSelectedColor: "#76B900",
      darkItemHoverColor: "#FFFFFF",
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={frFR} theme={nvidiaTheme}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfigProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
);
