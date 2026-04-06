import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        // FIXED: Glob patterns should only look at the 'dist' folder results
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      },
      // FIXED: Removed the icons/*.png pattern which was causing a glob mismatch error
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Sentry AI — Private Intelligence',
        short_name: 'Sentry AI',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        display: 'standalone',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      // FIXED: Use an absolute path for the url polyfill to satisfy Rolldown
      'url': resolve('node_modules/url/')
    }
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'],
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // FIXED: Arrow function for Rolldown compatibility
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('@mlc-ai') || id.includes('@huggingface')) return 'ai-engine';
            if (id.includes('@orama')) return 'vector-db';
            return 'vendor';
          }
        },
      },
    },
  },
})