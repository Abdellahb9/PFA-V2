// Full-screen branded splash shown during app bootstrap / first chunk load.
// Colors come from the AntD theme tokens, so it adapts to light/dark themes.
import { theme } from "antd";

interface Props {
  /** Optional message (also announced to screen readers). */
  tip?: string;
}

export default function AppLoader({ tip = "Chargement de l'application…" }: Props) {
  const { token } = theme.useToken();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: token.colorBgLayout,
      }}
    >
      {/* Animated logo + branding (pulse). */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          animation: "phos-pulse 1.6s ease-in-out infinite",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: token.colorPrimary,
            color: token.colorTextLightSolid,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 800,
            boxShadow: token.boxShadowSecondary,
          }}
        >
          P
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, color: token.colorText }}>
          PHOSBOUCRAA
        </div>
        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
          Assistant IA — Gestion des stages
        </div>
      </div>

      {/* Indeterminate progress bar. */}
      <div
        style={{
          position: "relative",
          width: 160,
          height: 4,
          borderRadius: 2,
          overflow: "hidden",
          background: token.colorFillSecondary,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: "40%",
            borderRadius: 2,
            background: token.colorPrimary,
            animation: "phos-bar 1.1s ease-in-out infinite",
          }}
        />
      </div>

      <span className="sr-only">{tip}</span>
    </div>
  );
}
