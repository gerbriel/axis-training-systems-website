/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
      colors: {
        // Primary
        navy:     { DEFAULT: '#0a1f3c', dark: '#10131a' },
        // Accents
        crimson:  { DEFAULT: '#c8102e', dark: '#a30c26' },
        gold:     { DEFAULT: '#f5b935', dark: '#c9960f' },
        bronze:   { DEFAULT: '#bfa162' },
        // Neutrals
        steel:    { DEFAULT: '#3a3f47' },
        chalk:    { DEFAULT: '#d6d6d6' },
        offwhite: { DEFAULT: '#faf9f5' },
        // Legacy alias keeps existing `text-red` / `bg-red` classes working
        red: { DEFAULT: '#c8102e', dark: '#a30c26' },
      },
    },
  },
  plugins: [],
}
