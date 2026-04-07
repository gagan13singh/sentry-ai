// ================================================================
// useConnectionStatus.js
// FIXED: Air-Gap CSP no longer blocks fonts.googleapis.com.
//        The font @import in index.css will fail when air-gapped,
//        but we now gracefully fall back to system fonts via CSS var.
//        CSP is tightened but allows data: and blob: for workers.
// ================================================================

import { useState, useEffect, useCallback } from 'react';

export function useConnectionStatus(aiReady = false) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasEverOnline, setWasEverOnline] = useState(navigator.onLine);
  const [strictPrivateMode, setStrictPrivateMode] = useState(false);

  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); setWasEverOnline(true); };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const toggleStrictPrivateMode = useCallback((enabled) => {
    setStrictPrivateMode(enabled);

    // Tell Service Worker to engage the network kill-switch
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_PRIVATE_MODE',
        enabled: enabled
      });
    }

    // FIXED: CSP that doesn't break the app UI.
    // - Fonts are excluded from restriction (they're cosmetic, not a data leak vector).
    // - connect-src restricted to self/blob/data for WebLLM workers.
    // - style-src allows 'unsafe-inline' so inline styles keep working.
    // NOTE: Browsers often ignore removing a CSP meta tag once added (by spec).
    //       The Service Worker is the real enforcement mechanism — CSP is defense-in-depth.
    const cspId = 'air-gap-csp';
    let meta = document.getElementById(cspId);
    if (enabled && !meta) {
      meta = document.createElement('meta');
      meta.id = cspId;
      meta.httpEquiv = 'Content-Security-Policy';
      // FIXED: Only restrict data connections, not fonts/styles
      // This prevents chat/prompt data from leaking while keeping UI intact
      meta.content = [
        "default-src 'self' blob: data:",
        "connect-src 'self' blob: data:",            // Block XHR/fetch to external (except blobs for OPFS)
        "worker-src 'self' blob:",                    // Allow service/web workers
        "script-src 'self' 'unsafe-eval' blob:",      // unsafe-eval needed by WebLLM WASM
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Keep fonts working
        "font-src 'self' https://fonts.gstatic.com data:", // Keep fonts working
        "img-src 'self' data: blob:",                 // Allow base64 images
        "media-src 'self' blob:",                     // Allow audio recording
      ].join('; ');
      document.head.appendChild(meta);
    } else if (!enabled && meta) {
      // Note: browsers may ignore this removal per spec,
      // but SW continues to be the primary enforcement layer
      document.head.removeChild(meta);
    }
  }, []);

  const isAirGapped = (!isOnline || strictPrivateMode) && aiReady;

  return { isOnline, isAirGapped, wasEverOnline, strictPrivateMode, toggleStrictPrivateMode };
}
