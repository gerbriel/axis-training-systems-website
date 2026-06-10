/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
      colors: {
        red: { DEFAULT: '#e63e3e', dark: '#c42e2e' },
      },
    },
  },
  plugins: [],
}
