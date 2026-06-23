/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Neue Montreal', 'ui-sans-serif', 'system-ui'] },
      colors: {
        // Surfaces — true black
        bg:       { DEFAULT: '#000000' },
        surface:  { DEFAULT: '#0d0d0d', raised: '#1a1a1a' },
        border:   { DEFAULT: '#222222' },
        // Brand accents — gold leads
        gold:     { DEFAULT: '#f5b935', soft: '#ffd782', dark: '#c9960f' },
        bronze:   { DEFAULT: '#bfa162', dark: '#9a7c3a' },
        // Secondary — deep purple for overlays
        purple:   { DEFAULT: '#0f096b', light: '#3b2f85' },
        // Tertiary — electric blues
        blue:     { DEFAULT: '#0d5bae' },
        cyan:     { DEFAULT: '#009dd6', light: '#00d1f0' },
        // Power accent — used sparingly
        crimson:  { DEFAULT: '#c8102e', dark: '#a30c26' },
        // Neutrals
        steel:    { DEFAULT: '#3a3f47' },
        chalk:    { DEFAULT: '#d6d6d6' },
        offwhite: { DEFAULT: '#faf9f5' },
        muted:    { DEFAULT: '#888888' },
        // Legacy alias
        red: { DEFAULT: '#c8102e', dark: '#a30c26' },
      },
    },
  },
  plugins: [],
}
