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
        // Increased to 10MB to handle Local AI WASM binaries
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
  resolve: {
    alias: {
      // Fixes the "url" module externalization warning for WebLLM
      url: 'url/'
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
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    // AI models generate large chunks; we increase this to avoid build warnings
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // FIXED: Using an arrow function for Rolldown (Vite 8) compatibility
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('@mlc-ai') || id.includes('@huggingface')) {
              return 'ai-core';
            }
            if (id.includes('@orama')) {
              return 'search-engine';
            }
            return 'vendor';
          }
        },
      },
    },
  },
})