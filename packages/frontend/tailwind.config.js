/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta financiera oscura
        surface: {
          0: '#0a0e17',    // Fondo principal
          1: '#111827',    // Cards
          2: '#1a2332',    // Cards elevadas
          3: '#243044',    // Hover/active
        },
        accent: {
          green: '#22c55e',
          red: '#ef4444',
          blue: '#3b82f6',
          amber: '#f59e0b',
          cyan: '#06b6d4',
        },
        muted: '#64748b',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
