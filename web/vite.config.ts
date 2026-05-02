/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
      '/api': {
        target: 'http://localhost:8080',
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
