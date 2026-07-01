// Application bootstrap: Redux + React Query + Ant Design (French locale).
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider } from "antd";
import frFR from "antd/locale/fr_FR";
import "antd/dist/reset.css";
import "dayjs/locale/fr";

import App from "./App";
import { store } from "./store";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// NVIDIA "Build" look in LIGHT mode — light surfaces, NVIDIA green accent, the
// constellation shows through transparent layout chrome. Centralised via tokens.
const enterpriseTheme = {
  token: {
    colorPrimary: "#76B900",
    colorInfo: "#76B900",
    colorLink: "#76B900",
    colorLinkHover: "#8FD400",
    colorBgLayout: "#f4f6f8",
    colorBorderSecondary: "#eceff3",
    borderRadius: 8,
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  components: {
    // Transparent header/body so the fixed constellation shows through; sider is
    // an opaque light panel.
    Layout: { headerBg: "transparent", bodyBg: "transparent", siderBg: "#ffffff" },
    Menu: { itemSelectedBg: "rgba(118,185,0,0.12)", itemSelectedColor: "#5a8f00" },
    // NVIDIA green is bright — dark text reads better on primary buttons.
    Button: { primaryColor: "#0A0A0A", fontWeight: 600 },
    Card: { colorBorderSecondary: "#eceff3" },
  },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={frFR} theme={enterpriseTheme}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfigProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
);
