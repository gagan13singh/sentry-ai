import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}', 'icons/*.png'],
        // Set to 10MB to handle heavy WASM files for Local AI
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
      manifest: {
        name: 'Sentry AI — Private Intelligence',
        short_name: 'Sentry AI',
        description: '100% local, air-gapped intelligence.',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        display: 'standalone',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // FIXED: Using a function to handle chunking for Vite 8
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Group AI dependencies to keep the main bundle light
            if (id.includes('@huggingface') || id.includes('@mlc-ai')) {
              return 'ai-engine';
            }
            // Keep the vector search separate
            if (id.includes('@orama')) {
              return 'vector-db';
            }
            // All other libraries go to vendor
            return 'vendor';
          }
        },
      },
    },
  },
})