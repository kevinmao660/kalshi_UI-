/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        kalshi: {
          bg: '#0B0E14',
          surface: '#131722',
          row: '#1E222D',
          rowAlt: '#191D28',
          border: '#2A2E39',
          text: '#F7F8F8',
          textSecondary: '#848E9C',
          textMuted: '#474D57',
          positive: '#0ECB81',
          negative: '#F6465D',
          accent: '#3861FB',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      keyframes: {
        'volume-flash': {
          '0%': { backgroundColor: 'rgba(14, 203, 129, 0.25)' },
          '50%': { backgroundColor: 'rgba(14, 203, 129, 0.08)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'volume-flash': 'volume-flash 0.7s ease-out forwards',
      },
    },
  },
  plugins: [],
}
