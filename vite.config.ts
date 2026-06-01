import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // includeAssets dropped — entries are duplicates of `workbox.globPatterns`
      // (the **/*.{png,webmanifest} glob already matches every icon + manifest).
      // Removing this dedup saves ~60 KB on the precache manifest.
      manifest: {
        name: 'OPTCGSandbox',
        short_name: 'Sandbox',
        description: 'Deck-testing sandbox for the One Piece Card Game.',
        theme_color: '#15140F',
        background_color: '#F2E8D2',
        display: 'fullscreen',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // The bundled cards.json + effectSpecV2 specs push the main JS chunk
        // above the 2 MB default. 5 MB headroom covers future card releases.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|webp|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'card-images',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
        ],
      },
    }),
  ],
})

