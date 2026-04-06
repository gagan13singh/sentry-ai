// ================================================================
// useConnectionStatus.js
// Tracks online/offline state and "air-gapped" mode (offline + AI ready)
// ================================================================

import { useState, useEffect, useCallback } from 'react';

export function useConnectionStatus(aiReady = false) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasEverOnline, setWasEverOnline] = useState(navigator.onLine);
  const [strictPrivateMode, setStrictPrivateMode] = useState(false);

  useEffect(() => {
    const handleOnline  = () => { setIsOnline(true);  setWasEverOnline(true); };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const toggleStrictPrivateMode = useCallback((enabled) => {
    setStrictPrivateMode(enabled);

    // 1. Tell Service Worker to engage the network kill-switch
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_PRIVATE_MODE',
        enabled: enabled
      });
    }

    // 2. Inject or remove CSP Meta Tag to literally shut off the internet for the app
    const cspId = 'air-gap-csp';
    let meta = document.getElementById(cspId);
    if (enabled && !meta) {
      meta = document.createElement('meta');
      meta.id = cspId;
      meta.httpEquiv = 'Content-Security-Policy';
      // Restrict all data to self. (Must allow data: and blob: for web workers and local OPFS)
      meta.content = "default-src 'self'; connect-src 'self' blob: data:;";
      document.head.appendChild(meta);
    } else if (!enabled && meta) {
      // NOTE: Browsers often DO NOT respect removing a CSP meta tag once it's added.
      // But we remove the element here anyway for DOM cleanliness. Security is maintained by SW.
      document.head.removeChild(meta);
    }
  }, []);

  const isAirGapped = (!isOnline || strictPrivateMode) && aiReady;

  return { isOnline, isAirGapped, wasEverOnline, strictPrivateMode, toggleStrictPrivateMode };
}
