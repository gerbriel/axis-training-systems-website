import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Base path is deploy-target aware:
  //   • Vercel serves from the domain root, so base must be '/'. Vercel sets
  //     the VERCEL env var automatically during its build.
  //   • GitHub Pages serves under the repo name, so it keeps the
  //     '/axis-training-systems-website/' prefix (also used by `npm run dev`).
  // This matters for auth: callbackUrl()/href() derive redirect URLs from
  // BASE_URL, so the wrong base sends Google/magic-link/reset links to a 404.
  base: process.env.VERCEL ? '/' : '/axis-training-systems-website/',
  appType: 'spa',
})
