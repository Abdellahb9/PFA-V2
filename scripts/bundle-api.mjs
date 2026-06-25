// Bundle the Vercel API adapter (which reuses the Netlify handlers) into a
// single self-contained CommonJS file. This sidesteps Vercel's per-file
// TypeScript checking and runtime ESM resolution of cross-directory imports.
import { build } from "esbuild";

await build({
  entryPoints: ["vercel-src/handler.ts"],
  outfile: "api/_handler.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "info",
});

console.log("✓ Bundled api/_handler.cjs");
