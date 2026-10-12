// @ts-nocheck
// Thin Vercel function entry. The real logic lives in a self-contained CommonJS
// bundle (api/_handler.cjs) produced by `scripts/bundle-api.mjs` at build time,
// so Vercel never has to type-check or resolve the server/ sources it bundles.
import * as bundle from "./_handler.cjs";

export const config = { maxDuration: 300 };
// Robust against CJS/ESM interop: the handler may be the default export or the
// module itself depending on how the entry is compiled.
export default bundle.default ?? bundle;
