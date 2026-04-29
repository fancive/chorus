import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        host: { DEFAULT: "#64748b", soft: "#e2e8f0" },
      },
    },
  },
  plugins: [],
};

export default config;
