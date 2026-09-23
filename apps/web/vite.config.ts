import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'IPL Community Grievance',
        short_name: 'IPL Grievance',
        description: 'Submit and track grievances with Indorama Eleme Petrochemicals Community Relations.',
        lang: 'en-NG',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F7F5F1',
        theme_color: '#0F5E5B',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is precached; data lives in IndexedDB and is synced by the app itself.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // Install-only icons and the Excel writer are not needed offline on a first visit.
        globIgnores: ['**/icons/icon-512.png', '**/icons/icon-maskable-512.png', '**/assets/excel-*', '**/assets/StaffApp-*'],
        // ...but once someone uses them (staff), keep them for offline use.
        runtimeCaching: [{
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
          handler: 'CacheFirst',
          options: { cacheName: 'lazy-assets', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 60 } },
        }],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(auth|rest|functions)\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2019',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@supabase/supabase-js', '@tanstack/react-query', 'dexie'],
          excel: ['write-excel-file'],
        },
      },
    },
  },
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
} as any);
