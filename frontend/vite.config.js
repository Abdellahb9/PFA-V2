import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// Vite config: React plugin, "@/" alias and a dev proxy to the FastAPI backend.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:8000",
                changeOrigin: true,
            },
        },
    },
});
