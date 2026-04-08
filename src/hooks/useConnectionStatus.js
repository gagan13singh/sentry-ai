// ================================================================
// useConnectionStatus.js
//
// BUG FIXES:
// 1. `toggleStrictPrivateMode` accepted an argument (newValue) but the
//    hook also auto-toggled its own state — callers that passed `!current`
//    caused the hook to set it to `!current` THEN toggle again, resulting
//    in a double-flip.  Now the function takes no arguments and simply
//    flips its own internal state.
//
// 2. The service worker `postMessage` was sent before checking if a
//    service worker registration exists.  On Firefox or browsers without
//    SW support, `navigator.serviceWorker.controller` can be null even
//    after registration — the null check was missing.
//
// 3. `isAirGapped` was computed as `!isOnline && !strictPrivateMode` which
//    is wrong — the device can be truly offline (isAirGapped = true) even
//    without strictPrivateMode being on.  Fixed to `!isOnline`.
//    `strictPrivateMode` is a SEPARATE software kill-switch that works
//    even when online.
//
// 4. Window `online`/`offline` event listeners were added but never
//    removed, causing a listener leak if the component remounted.
//    Now cleaned up in the useEffect return.
// ================================================================

import { useState, useEffect, useCallback, useRef } from 'react';

export function useConnectionStatus(modelReady) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [strictPrivateMode, setStrictPrivateMode] = useState(() => {
    try { return localStorage.getItem('sentry-strict-mode') === 'true'; }
    catch { return false; }
  });

  // FIX: true air-gap = simply not online
  const isAirGapped = !isOnline;

  // ── Sync with network events ──────────────────────────────────
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // FIX: cleanup listeners on unmount
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Notify service worker of mode change ──────────────────────
  const notifyServiceWorker = useCallback((enabled) => {
    try {
      // FIX: check controller exists before posting
      const sw = navigator.serviceWorker?.controller;
      if (sw) {
        sw.postMessage({ type: 'SET_PRIVATE_MODE', enabled });
      }
    } catch {
      // Service worker messaging not available
    }
  }, []);

  // Persist and notify on change
  useEffect(() => {
    try { localStorage.setItem('sentry-strict-mode', String(strictPrivateMode)); }
    catch { /* ignore */ }
    notifyServiceWorker(strictPrivateMode);
  }, [strictPrivateMode, notifyServiceWorker]);

  // FIX: no argument — pure toggle
  const toggleStrictPrivateMode = useCallback(() => {
    setStrictPrivateMode(prev => !prev);
  }, []);

  return {
    isOnline,
    isAirGapped,
    strictPrivateMode,
    toggleStrictPrivateMode,
  };
}