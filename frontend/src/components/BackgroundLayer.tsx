// Fixed, non-interactive page background (NVIDIA "Build" look): near-black base
// + drifting constellation mesh + a soft green glow anchored at the bottom.
// Sits behind all content; page containers must be transparent to reveal it.
import ConstellationCanvas from "./ConstellationCanvas";

export default function BackgroundLayer() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -10,
        pointerEvents: "none",
        background: "#0A0A0A",
      }}
    >
      <ConstellationCanvas
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.9 }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 65% at 50% 100%, rgba(118,185,0,0.22) 0%, rgba(118,185,0,0.09) 38%, transparent 72%)",
        }}
      />
    </div>
  );
}
