// Suspense fallback for lazy-loaded pages: a centered spinner that keeps the
// surrounding layout (sidebar/header) visible during navigation.
import { Spin } from "antd";

export default function RouteFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="phos-fade-in"
      style={{
        minHeight: 360,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spin size="large" />
      <span className="sr-only">Chargement de la page…</span>
    </div>
  );
}
