/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef2f2",
          100: "#ffe1e1",
          200: "#ffc8c8",
          300: "#ffa3a3",
          400: "#ff6b6b",
          500: "#ff3b3b",
          600: "#ed1c24",
          700: "#c8102c",
          800: "#a6102b",
          900: "#89122a",
        },
      },
    },
  },
  plugins: [],
};
