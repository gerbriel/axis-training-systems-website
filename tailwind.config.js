/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
      colors: {
        // Surfaces
        bg:       { DEFAULT: '#0a1a33' },
        surface:  { DEFAULT: '#0b2f5b', raised: '#15375f' },
        border:   { DEFAULT: '#1c3a63' },
        // Brand accents — gold leads
        gold:     { DEFAULT: '#f5b935', soft: '#ffd782', dark: '#c9960f' },
        bronze:   { DEFAULT: '#bfa162', dark: '#9a7c3a' },
        // Power accent — used sparingly
        crimson:  { DEFAULT: '#c8102e', dark: '#a30c26' },
        // Neutrals
        steel:    { DEFAULT: '#3a3f47' },
        chalk:    { DEFAULT: '#d6d6d6' },
        offwhite: { DEFAULT: '#faf9f5' },
        muted:    { DEFAULT: '#9aa3af' },
        // Legacy alias
        red: { DEFAULT: '#c8102e', dark: '#a30c26' },
      },
    },
  },
  plugins: [],
}
