// Runtime theme switch between the dark and light NVIDIA looks (persisted).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider } from "antd";
import frFR from "antd/locale/fr_FR";
import { darkTheme, lightTheme, modeVisuals } from "./themes";

export type ThemeMode = "dark" | "light";
const STORAGE_KEY = "app-theme-mode";

interface ThemeCtx {
  mode: ThemeMode;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ mode: "light", toggle: () => {} });
export const useThemeMode = () => useContext(Ctx);

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemeMode) || "light",
  );

  // Keep the page base colour in sync. It lives on <html> (painted behind the
  // fixed BackgroundLayer) so the constellation stays visible; setting it on
  // body/#root would paint over the layer and hide it. The data-theme attribute
  // lets plain CSS pick the right glass variables (backdrop-filter can't be
  // expressed as an AntD token).
  useEffect(() => {
    document.documentElement.style.background = modeVisuals[mode].base;
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const value = useMemo<ThemeCtx>(
    () => ({
      mode,
      toggle: () =>
        setMode((m) => {
          const next = m === "dark" ? "light" : "dark";
          localStorage.setItem(STORAGE_KEY, next);
          return next;
        }),
    }),
    [mode],
  );

  return (
    <Ctx.Provider value={value}>
      <ConfigProvider locale={frFR} theme={mode === "dark" ? darkTheme : lightTheme}>
        {children}
      </ConfigProvider>
    </Ctx.Provider>
  );
}
