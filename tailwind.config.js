/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          bg: "#121214",
          panel: "#1a1a1e",
          panelLight: "#222228",
          border: "#2a2a30",
          borderLight: "#3a3a44",
          text: "#e4e4e7",
          muted: "#9ca3af",
          accent: {
            bass: "#10b981",    // Neon Funk Green
            keys: "#06b6d4",    // Electric Cyan
            brass: "#f59e0b",   // Funk Amber
            drums: "#a855f7",   // Neon Purple
            alert: "#ef4444"
          }
        }
      },
      boxShadow: {
        'glow-bass': '0 0 15px rgba(16, 185, 129, 0.45)',
        'glow-keys': '0 0 15px rgba(6, 182, 212, 0.45)',
        'glow-brass': '0 0 15px rgba(245, 158, 11, 0.45)',
        'glow-drums': '0 0 15px rgba(168, 85, 247, 0.45)',
        'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.3)',
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      },
      gridTemplateColumns: {
        '16': 'repeat(16, minmax(0, 1fr))',
      }
    },
  },
  plugins: [],
}
