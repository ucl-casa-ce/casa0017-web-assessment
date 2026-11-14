import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // The river model is shared with the backend and lives outside this folder (Website/shared/river)
  esbuild: { supported: { 'top-level-await': true } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022', // top-level await in src/river/app.js
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        triggers: resolve(import.meta.dirname, 'triggers.html'),
        tide: resolve(import.meta.dirname, 'tide.html'),
        method: resolve(import.meta.dirname, 'method.html'),
        live: resolve(import.meta.dirname, 'live.html'),
        liveMethod: resolve(import.meta.dirname, 'live-method.html'),
      },
    },
  },
  worker: { format: 'es' }, // the model Web Worker uses ES imports
  server: {
    // 5173 = the port docker-compose publishes and the backend's CORS_ORIGIN default.
    // (3000 is the backend's port, so the dev server can't use it too.)
    port: 5173,
    open: true,
    fs: { allow: [resolve(import.meta.dirname, '..')] }, // Website/ (frontend + shared)
    // In Docker on Windows/macOS the dev server is not told when a file changes, so it would keep
    // serving old code until restarted. VITE_USE_POLLING=true (set in docker-compose.yml) makes it
    // check the files itself. [PARAM] interval in ms: lower = picks up edits sooner, more CPU.
    watch: process.env.VITE_USE_POLLING === 'true' ? { usePolling: true, interval: 1000 } : undefined,
  },
})
