import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 18px 55px rgba(15, 23, 42, 0.10)",
        glow: "0 0 0 1px rgba(20, 184, 166, 0.14), 0 18px 50px rgba(20, 184, 166, 0.18)"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "pulse-line": {
          "0%, 100%": { transform: "scaleX(0.18)", opacity: "0.45" },
          "50%": { transform: "scaleX(1)", opacity: "1" }
        },
        shimmer: {
          "0%": { backgroundPosition: "100% 0" },
          "100%": { backgroundPosition: "-100% 0" }
        }
      },
      animation: {
        "fade-up": "fade-up 520ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-line": "pulse-line 1.6s ease-in-out infinite",
        shimmer: "shimmer 1.35s linear infinite"
      }
    }
  },
  plugins: []
};

export default config;
