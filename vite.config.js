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
        // Increased slightly to 10MB to accommodate heavy WASM binaries for OCR/Transformers
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
      manifest: {
        name: 'Sentry AI — Private Intelligence',
        short_name: 'Sentry AI',
        description: 'The AI that never phones home. 100% local, air-gapped intelligence.',
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
      'Cross-Origin-Embedder-Policy': 'require-corp', // Essential for WebGPU/SharedArrayBuffer
    },
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'], // Prevents Vite from trying to pre-bundle the heavy engine
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // FIXED: Using a function instead of an object for Vite 8 compatibility
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@huggingface') || id.includes('@mlc-ai')) {
              return 'ai-engine'; // Group all AI logic into one chunk
            }
            if (id.includes('@orama')) {
              return 'vector-db'; // Keep the search engine separate
            }
            return 'vendor'; // Everything else (React, etc.)
          }
        },
      },
    },
  },
})