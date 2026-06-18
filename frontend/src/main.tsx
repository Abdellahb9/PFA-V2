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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider
          locale={frFR}
          theme={{ token: { colorPrimary: "#00843d", borderRadius: 8 } }}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfigProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
);
