// Feature flags.
// The animated constellation background belongs to the dark "NVIDIA" look; the
// light enterprise theme turns it off by default. It is kept (not deleted) and
// can be re-enabled with VITE_SHOW_CONSTELLATION=true.
export const SHOW_CONSTELLATION = import.meta.env.VITE_SHOW_CONSTELLATION === "true";
