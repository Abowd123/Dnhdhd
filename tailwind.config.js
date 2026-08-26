/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // خطوط عربية متوفرة على معظم الأنظمة، بلا اعتماد على شبكة
        sans: ["Segoe UI", "Tahoma", "Noto Sans Arabic", "Cairo", "sans-serif"],
        mono: ["ui-monospace", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
