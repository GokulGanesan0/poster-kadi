import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        panel: "var(--panel)",
        panelSoft: "var(--panel-soft)",
        line: "var(--line)",
        paper: "var(--paper)",
        ember: "var(--ember)",
        mint: "var(--mint)",
        brass: "var(--brass)"
      },
      boxShadow: {
        glow: "0 18px 60px rgba(227, 93, 50, 0.14)"
      }
    }
  },
  plugins: []
};

export default config;
