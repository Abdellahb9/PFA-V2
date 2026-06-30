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

// Light, professional "enterprise" theme — clean, flat, recruiter-scannable.
// Centralised here via AntD tokens (default = light algorithm). OCP brand green.
const enterpriseTheme = {
  token: {
    colorPrimary: "#00843d",
    colorInfo: "#00843d",
    colorLink: "#00843d",
    colorLinkHover: "#00a04a",
    colorBgLayout: "#f4f6f8",
    colorBorderSecondary: "#eceff3",
    borderRadius: 8,
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  components: {
    Layout: { headerBg: "#ffffff", bodyBg: "#f4f6f8", siderBg: "#ffffff" },
    Menu: { itemSelectedBg: "rgba(0,132,61,0.10)", itemSelectedColor: "#00843d" },
    Button: { primaryColor: "#ffffff", fontWeight: 600 },
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
