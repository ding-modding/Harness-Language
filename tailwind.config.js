/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        harness: {
          bg: "#0B0F17",
          panel: "#131B2A",
          border: "#232F46",
          accent: "#38BDF8",
          success: "#10B981",
          warning: "#F59E0B",
          danger: "#EF4444"
        }
      }
    },
  },
  plugins: [],
}
