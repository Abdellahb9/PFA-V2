// Fixed, non-interactive NVIDIA "Build" background: base fill + drifting
// constellation mesh + soft green glow. Adapts to the current theme mode
// (dark near-black canvas vs light canvas). Behind everything, non-interactive.
import ConstellationCanvas from "./ConstellationCanvas";
import { useThemeMode } from "@/theme/ThemeProvider";
import { modeVisuals } from "@/theme/themes";

export default function BackgroundLayer() {
  const { mode } = useThemeMode();
  const v = modeVisuals[mode];

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -10,
        pointerEvents: "none",
        background: v.base,
      }}
    >
      <ConstellationCanvas
        key={mode} // remount so the new alphas apply on toggle
        nodeAlpha={v.nodeAlpha}
        lineAlpha={v.lineAlpha}
        triAlpha={v.triAlpha}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: v.canvasOpacity,
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: v.glow }} />
    </div>
  );
}
