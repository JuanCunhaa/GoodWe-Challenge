/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      colors: {
        brand: {
          DEFAULT: "#16a34a",
          50:"#ecfdf5",100:"#d1fae5",200:"#a7f3d0",300:"#6ee7b7",
          400:"#34d399",500:"#10b981",600:"#059669",700:"#047857",
          800:"#065f46",900:"#064e3b"
        },
        secondary: {
          DEFAULT: "#ef4444",
          50:"#fef2f2",100:"#fee2e2",200:"#fecaca",300:"#fca5a5",
          400:"#f87171",500:"#ef4444",600:"#dc2626",700:"#b91c1c",
          800:"#991b1b",900:"#7f1d1d"
        },
        app: { light:"#f5faf7", dark:"#0b0f12" }
      },
      boxShadow: {
        soft: "0 12px 30px -20px rgb(0 0 0 / 0.35)",
        ring: "0 0 0 2px rgb(16 185 129 / 0.20)",
        glow: "0 0 0 3px rgba(239,68,68,0.18)",
        neon: "0 10px 40px -10px rgba(16,185,129,0.35)"
      },
      backgroundImage: {
        'mesh-light': 'radial-gradient(900px 300px at -5% -10%, rgba(20,184,166,0.25), transparent 60%), radial-gradient(600px 200px at 110% -10%, rgba(217,119,6,0.18), transparent 60%), radial-gradient(1200px 600px at 30% 120%, rgba(59,130,246,0.18), transparent 60%)',
        'mesh-dark' : 'radial-gradient(900px 300px at -5% -10%, rgba(5,150,105,0.2), transparent 60%), radial-gradient(600px 200px at 110% -10%, rgba(153,27,27,0.2), transparent 60%), radial-gradient(1200px 600px at 30% 120%, rgba(15,23,42,0.5), transparent 60%)'
      },
      keyframes: {
        shimmer: { '0%':{ backgroundPosition:'-200% 0' }, '100%':{ backgroundPosition:'200% 0' } },
        float: { '0%,100%':{ transform:'translateY(0)' }, '50%':{ transform:'translateY(-6px)' } }
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        float: 'float 6s ease-in-out infinite'
      },
      borderRadius: { '2xl':'1rem', '3xl':'1.5rem' }
    }
  },
  plugins: []
}
