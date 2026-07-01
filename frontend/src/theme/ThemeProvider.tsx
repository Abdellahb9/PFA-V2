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

  // Keep the page background in sync (also covers the pre-mount flash).
  useEffect(() => {
    document.body.style.background = modeVisuals[mode].base;
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
