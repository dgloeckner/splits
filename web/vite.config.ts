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
      // The service worker precaches the app shell only. /api/* must
      // never be cached — the backend SQLite DB is the source of truth,
      // and stale API responses would lie to the user after DB writes.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        // Streaming SSE must NOT pass through Workbox at all.
        // `NetworkOnly` reads the response body to evaluate the
        // cache policy, which breaks `text/event-stream`: the
        // browser's EventSource never sees the body so `onopen`
        // never fires and the connection indicator stays stuck on
        // "connecting". Excluding the stream URL from the runtime
        // cache rule lets the SW pass it straight through to the
        // network. The rest of /api/* keeps NetworkOnly so PWA
        // offline behaviour is unchanged.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/api/v1/stream'),
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
