// Feature flags.
// The NVIDIA-style constellation background is ON by default (light-mode NVIDIA
// look). Disable it with VITE_SHOW_CONSTELLATION=false.
export const SHOW_CONSTELLATION = import.meta.env.VITE_SHOW_CONSTELLATION !== "false";
