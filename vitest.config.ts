// Tests de l'API (server/). Le frontend a sa propre configuration (frontend/vite.config.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts"],
  },
});
