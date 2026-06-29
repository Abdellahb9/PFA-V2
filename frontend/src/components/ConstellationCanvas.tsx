// Drifting low-poly "constellation" mesh (NVIDIA Build aesthetic). Sparse green
// nodes linked by faint lines + a few accent triangles. Stays a whisper behind
// content. Respects prefers-reduced-motion (renders one static frame).
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

const GREEN = "118,185,0";
const LINK_DIST = 140;

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}
interface Tri {
  x: number;
  y: number;
  s: number;
  rot: number;
}

export default function ConstellationCanvas({ style }: { style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let nodes: Node[] = [];
    let tris: Tri[] = [];
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      // Scale node count by viewport area, capped for performance.
      const count = Math.min(240, Math.round((canvas.width * canvas.height) / 18000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() < 0.15 ? 2 : 1,
      }));
      tris = Array.from({ length: Math.max(3, Math.round(count / 12)) }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        s: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
      }));
      if (reduce) render(false);
    };

    const render = (move: boolean) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Accent triangles (static, low alpha).
      ctx.fillStyle = `rgba(${GREEN},0.3)`;
      for (const t of tris) {
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(t.rot);
        ctx.beginPath();
        ctx.moveTo(0, -t.s);
        ctx.lineTo(t.s, t.s);
        ctx.lineTo(-t.s, t.s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Links (closer = brighter, still faint).
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            ctx.strokeStyle = `rgba(${GREEN},${0.2 * (1 - d / LINK_DIST)})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Nodes.
      ctx.fillStyle = `rgba(${GREEN},0.75)`;
      for (const n of nodes) {
        if (move) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
          if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

    };

    // Throttle to ~30fps and pause when the tab is hidden — keeps the drift
    // light so it never saturates the main thread.
    let last = 0;
    const FRAME_MS = 1000 / 30;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      last = t;
      render(true);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!reduce && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    resize();
    if (reduce) render(false);
    else raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} style={style} aria-hidden="true" />;
}
