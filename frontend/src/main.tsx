// Application bootstrap: Redux + React Query + Ant Design (French locale).
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "antd/dist/reset.css";
import dayjs from "dayjs";
// Importing the locale only registers it — it has to be activated too, or
// dayjs keeps formatting month names in English under a French UI.
import "dayjs/locale/fr";
dayjs.locale("fr");
// Self-hosted variable fonts (no CDN request, no layout shift from a third
// party). Each file is unicode-range subsetted, so a French page only ever
// downloads the latin cut. Inter carries the UI; Space Grotesk the headings.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";

import App from "./App";
import { store } from "./store";
import ThemeProvider from "./theme/ThemeProvider";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
);
