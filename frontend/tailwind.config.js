/** @type {import('tailwindcss').Config} */
// Colour scheme shared with the Vogel-Kamera interface (GitHub dark).
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d1117',
        surface: '#161b22',
        line: '#30363d',
        fg: '#e6edf3',
        muted: '#8b949e',
        accent: '#58a6ff',
        ok: '#3fb950',
        warn: '#d29922',
        bad: '#f85149',
        // Existing gray utilities follow the same palette
        gray: {
          900: '#0d1117',
          800: '#161b22',
          700: '#30363d',
          600: '#3d444d',
          500: '#6e7681',
          400: '#8b949e',
          300: '#c9d1d9',
          200: '#e6edf3',
          100: '#f0f6fc'
        }
      },
      borderRadius: {
        DEFAULT: '8px'
      }
    }
  },
  plugins: []
};
