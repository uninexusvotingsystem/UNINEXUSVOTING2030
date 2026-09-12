import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0A0A0B",
          soft: "#141416",
          line: "#232326",
        },
        gold: {
          DEFAULT: "#C9A227",
          light: "#E8CB6E",
          deep: "#8F6E14",
          foil: "#F4E3A1",
        },
        cream: {
          DEFAULT: "#FAF7EF",
          dim: "#F1ECDD",
        },
        ivory: "#FFFFFF",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "gold-foil": "linear-gradient(135deg, #F4E3A1 0%, #C9A227 45%, #8F6E14 100%)",
        "ink-fade": "linear-gradient(180deg, #0A0A0B 0%, #141416 100%)",
      },
      boxShadow: {
        gold: "0 0 0 1px rgba(201,162,39,0.35), 0 20px 60px -24px rgba(201,162,39,0.55)",
        elegant: "0 1px 2px rgba(0,0,0,0.06), 0 16px 40px -20px rgba(0,0,0,0.35)",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "count-pop": {
          "0%": { transform: "scale(0.9)", opacity: "0.6" },
          "60%": { transform: "scale(1.04)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        marquee: "marquee 28s linear infinite",
        "fade-up": "fade-up 0.7s cubic-bezier(0.22,1,0.36,1) both",
        "count-pop": "count-pop 0.5s ease-out both",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
