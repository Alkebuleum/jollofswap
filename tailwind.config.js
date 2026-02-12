/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        jlfTomato: "#E24E2A",
        jlfPepper: "#C0351A",
        jlfRice: "#F3C892",
        jlfPlantain: "#F2B705",
        jlfIvory: "#FFF8F0",
        jlfCharcoal: "#1B1B1F",
      },
      boxShadow: {
        card: "0 8px 24px rgba(226,78,42,0.08)"
      },
      borderColor: {
        brand: "rgba(226,78,42,0.18)"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "ui-sans-serif", "Segoe UI", "Arial", "Noto Sans", "sans-serif"]
      },
      borderRadius: {
        xl2: "1rem"
      }
    },
  },
  plugins: [],
}