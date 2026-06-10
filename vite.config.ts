import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages base path — matches the repo name
  base: '/axis-training-systems-website/',
  appType: 'spa',
})
