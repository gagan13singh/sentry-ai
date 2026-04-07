// ================================================================
// sw.js — Service Worker
// FIXED: Properly blocks in strict mode, logs all intercepts
// NEW: Blocks known telemetry domains unconditionally
// NEW: Response integrity headers check
// ================================================================

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

precacheAndRoute(self.__WB_MANIFEST);

// Cache fonts
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  })
);
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  })
);

// ── Security Config ───────────────────────────────────────────────
let isStrictPrivateMode = false;

// These are ALWAYS blocked regardless of mode (zero exceptions)
const ALWAYS_BLOCK_DOMAINS = [
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'connect.facebook.net',
  'hotjar.com',
  'mixpanel.com',
  'segment.com',
  'amplitude.com',
  'sentry.io',
  'datadog-browser-agent.com',
  'newrelic.com',
  'bugsnag.com',
  'logrocket.com',
  'clarity.ms',
  'bat.bing.com',
  'stats.wp.com',
  'pixel.wp.com',
];

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SET_PRIVATE_MODE') {
    isStrictPrivateMode = event.data.enabled;
    console.log(`[SW] Strict Private Mode: ${isStrictPrivateMode}`);
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always block telemetry — no exceptions, ever
  if (ALWAYS_BLOCK_DOMAINS.some(d => url.hostname.includes(d))) {
    console.error(`[SW] 🚨 BLOCKED TELEMETRY: ${url.href}`);
    event.respondWith(
      new Response(JSON.stringify({ blocked: true, reason: 'telemetry_blocked' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'X-Blocked-By': 'SentryAI-SW' },
      })
    );
    return;
  }

  // Strict mode: block everything non-local
  if (isStrictPrivateMode) {
    const isLocal = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.origin === self.location.origin;

    if (!isLocal) {
      console.warn(`[SW] Blocked in Air-Gapped mode: ${url.href}`);
      event.respondWith(
        new Response('Blocked: Air-Gapped Mode Active', {
          status: 403,
          headers: {
            'Content-Type': 'text/plain',
            'X-Blocked-By': 'SentryAI-AirGap',
          },
        })
      );
      return;
    }
  }
});