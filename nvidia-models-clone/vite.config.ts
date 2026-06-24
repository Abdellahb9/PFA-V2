import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Honor a PORT env var (used by the preview harness) so the browser and the
// dev server agree on the port; fall back to Vite's default otherwise.
export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: Boolean(process.env.PORT),
  },
});
