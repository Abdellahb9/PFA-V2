// @ts-nocheck
// Thin Vercel function entry. The real logic lives in a self-contained CommonJS
// bundle (api/_handler.cjs) produced by `scripts/bundle-api.mjs` at build time,
// so Vercel never has to type-check or resolve the Netlify handlers it reuses.
import handler from "./_handler.cjs";

export const config = { maxDuration: 60 };
export default handler;
