/// <reference types="vitest" />
import { execSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

function gitDirty(): boolean {
  try {
    const out = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return out.length > 0
  } catch {
    return false
  }
}

const buildSha = gitShortSha() + (gitDirty() ? '-dirty' : '')
const buildTime = new Date().toISOString()

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['favicon.svg'],
      // ADR-0019: the offline trainer-demo reads are served from a
      // durable SW runtime cache (NetworkFirst) so they survive an iOS
      // cold PWA relaunch, which evicts/empties the react-query
      // IndexedDB bag (ADR-0018's load-bearing store). The network
      // always wins when it answers, so an online user never sees stale
      // data; the cache only serves when the fetch fails. Staleness is
      // labelled in the app via the reachability probe + "Stand: …"
      // notice (see web/src/offline/reachability.ts), NOT inferred from
      // query success. Mutations, /api/health (the probe), the SSE
      // stream and session control stay NetworkOnly.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Offline-read GETs. Keep in sync with isOfflineReadPath in
            // web/src/offline/swRoutes.ts — this copy must be
            // self-contained so Workbox can inline it into the SW.
            urlPattern: ({ url, request }) => {
              if (request.method !== 'GET') return false
              const p = url.pathname.replace(/\/+$/, '')
              if (
                p === '/api/v1/rowers' ||
                p === '/api/v1/active-rower' ||
                p === '/api/v1/favorites' ||
                p === '/api/v1/sessions'
              ) {
                return true
              }
              const s = p.split('/').filter(Boolean)
              if (s[0] === 'api' && s[1] === 'v1' && s[2] === 'rowers' && s.length === 5) {
                return (
                  s[4] === 'pbs' ||
                  s[4] === 'lifetime' ||
                  s[4] === 'achievements' ||
                  s[4] === 'trends'
                )
              }
              if (s[0] === 'api' && s[1] === 'v1' && s[2] === 'sessions') {
                if (s[3] === 'stale-open') return false
                if (s.length === 4) return true
                if (s.length === 5) return s[4] === 'samples' || s[4] === 'pb-banners'
                return false
              }
              if (s[0] === 'api' && s[1] === 'v1' && s[2] === 'workouts' && s.length === 4) {
                return s[3] !== 'last'
              }
              return false
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'splits-api-read',
              networkTimeoutSeconds: 6,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Everything else under /api — mutations, /api/health (the
            // uncached reachability probe), session control, stale-open,
            // and the SSE stream — must never be cached. NetworkOnly on
            // the stream also keeps text/event-stream pass-through intact
            // (Workbox reading the body would stall EventSource.onopen).
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'splits',
        short_name: 'splits',
        description: 'Home rowing ergometer companion',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      // VITE_BACKEND_URL is per-worker in e2e (0016-05): the worker-scoped
      // Vite fixture spawns this dev server with a backend URL pointing
      // at the worker's own dynamic-port backend, so multiple parallel
      // agents do not share port 8080.
      '/api': {
        target: process.env.VITE_BACKEND_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
  },
})
