import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/ion-print-studio/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-192.svg', 'pwa-512.svg'],
      manifest: {
        name: 'ION Print Studio',
        short_name: 'ION Print',
        description: 'A local-first A4 image print layout editor',
        theme_color: '#ffffff',
        background_color: '#f1f5f9',
        display: 'standalone',
        start_url: '/ion-print-studio/',
        scope: '/ion-print-studio/',
        icons: [
          {
            src: '/ion-print-studio/pwa-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: '/ion-print-studio/pwa-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    include: ['konva', 'react-konva'],
  },
})
