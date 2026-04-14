export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        urgency: {
          low: "#10b981",
          medium: "#f59e0b",
          high: "#ef4444",
          critical: "#991b1b",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
