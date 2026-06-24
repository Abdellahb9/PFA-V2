/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        "nv-bg": "#0A0A0A",
        "nv-panel": "#161616",
        "nv-elevated": "#1F1F1F",
        // Borders
        "nv-border": "#2A2A2A",
        "nv-border-strong": "#3A3A3A",
        // Brand
        "nv-green": "#76B900",
        "nv-green-hover": "#8FD400",
        // Text
        "nv-text": "#FFFFFF",
        "nv-text-secondary": "#B4B4B4",
        "nv-text-muted": "#6E6E6E",
        // Badges
        "badge-blue": "#4A9EFF",
        "badge-purple": "#A855F7",
      },
      fontFamily: {
        sans: ['"NVIDIA Sans"', "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        input: "8px",
        card: "12px",
      },
      maxWidth: {
        container: "1440px",
      },
      letterSpacing: {
        tightest: "-0.02em",
      },
      boxShadow: {
        "green-glow": "0 0 0 1px rgba(118,185,0,0.4), 0 0 24px -6px rgba(118,185,0,0.25)",
      },
    },
  },
  plugins: [],
};
