/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        'bg-primary': '#0f1419',
        'bg-panel': '#1a2129',
        'bg-panel-alt': '#232c37',
      },
    },
  },
  plugins: [],
};
