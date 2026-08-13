import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Base path, resolved per deploy target.
 *
 * GitHub Pages serves this repo from a subpath, so every asset URL has to be
 * prefixed with the repo name. Vercel serves it from the domain root, and the
 * hardcoded subpath was actively breaking that deploy: index.html asked for
 * /axis-training-systems-website/assets/index-*.js, no such file exists in the
 * output, the SPA rewrite in vercel.json caught the 404 and returned
 * index.html, and the browser refused an HTML body offered as a JS module — a
 * blank page with a MIME-type error and no obvious cause.
 *
 * VITE_BASE_PATH overrides both. Set it to "/" when GitHub Pages is pointed at
 * the axistrainingsystems.com apex domain, since a custom domain also serves
 * from the root and would hit the exact same failure.
 */
const base =
  process.env.VITE_BASE_PATH ??
  (process.env.VERCEL ? '/' : '/axis-training-systems-website/')

/**
 * Vite minifies JS and CSS but ships index.html comments verbatim.
 *
 * index.html carries a long per-origin justification for the CSP, which is
 * exactly where that reasoning belongs — the next person to add an origin reads
 * it there or not at all. It is not something to serve to visitors: it tripled
 * the HTML and published internal notes about which third parties this site
 * leans on and which line to change to weaken the policy. Reconnaissance, free
 * of charge.
 *
 * Stripped on build only, so `npm run dev` keeps the comments in the served
 * HTML where they are useful.
 */
function stripHtmlComments(): Plugin {
  return {
    name: 'strip-html-comments',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: (html: string) =>
        // Non-greedy, so each comment closes at its own `-->`. Safe here because
        // no attribute value in this document contains that sequence, and
        // `<!DOCTYPE` is not matched by `<!--`.
        html.replace(/\n?[ \t]*<!--[\s\S]*?-->/g, ''),
    },
  }
}

export default defineConfig({
  plugins: [react(), stripHtmlComments()],
  base,
  appType: 'spa',
})
