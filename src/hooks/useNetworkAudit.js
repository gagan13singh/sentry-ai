// ================================================================
// useNetworkAudit.js
// FIXED: Font CDN (googleapis, gstatic) and pdfjs CDN (jsdelivr)
//        no longer marked as "suspicious" — they're known asset CDNs
// FIXED: HuggingFace/MLC calls correctly classified as EXTERNAL/expected
// FIXED: "suspicious" = genuinely unexpected calls only
// ================================================================

import { useState, useEffect, useRef, useCallback } from 'react';

// Known legitimate external domains during MODEL DOWNLOAD phase only
const KNOWN_MODEL_DOMAINS = [
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'raw.githubusercontent.com',
  'github.com',
];

// FIXED: Added jsdelivr (used by pdfjs-dist worker) and fonts CDN
const KNOWN_ASSET_DOMAINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',   // pdfjs worker + other assets
  'npmjs.com',
  'unpkg.com',
];

// Domains that are NEVER acceptable (telemetry, tracking, ads)
const BLOCKED_TELEMETRY_DOMAINS = [
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'facebook.com',
  'connect.facebook.net',
  'hotjar.com',
  'mixpanel.com',
  'segment.com',
  'amplitude.com',
  'sentry.io',
  'datadog-browser-agent',
  'newrelic.com',
  'bugsnag.com',
  'logrocket.com',
  'clarity.ms',
  'bat.bing.com',
];

function classifyRequest(url) {
  try {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();
    const origin = typeof location !== 'undefined' ? location.origin : '';

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      (origin && u.origin === origin)
    ) {
      return { category: 'local', risk: 'none', label: 'Local Asset' };
    }

    if (BLOCKED_TELEMETRY_DOMAINS.some(d => hostname.includes(d))) {
      return { category: 'telemetry', risk: 'critical', label: '🚨 Telemetry/Tracker' };
    }

    // FIXED: Font CDN and pdfjs CDN are known assets — not suspicious
    if (KNOWN_ASSET_DOMAINS.some(d => hostname.includes(d))) {
      return { category: 'asset', risk: 'low', label: 'Known CDN Asset' };
    }

    if (KNOWN_MODEL_DOMAINS.some(d => hostname.includes(d))) {
      return { category: 'model_download', risk: 'expected', label: 'Model Download (External)' };
    }

    // Anything else is unexpected
    return { category: 'unexpected', risk: 'high', label: '⚠ Unexpected External' };
  } catch {
    return { category: 'unknown', risk: 'medium', label: 'Unknown' };
  }
}

export function useNetworkAudit() {
  const [requests, setRequests] = useState([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [sessionStats, setSessionStats] = useState({ totalBytes: 0, totalRequests: 0, externalBytes: 0 });
  const observerRef = useRef(null);

  const startMonitoring = useCallback(() => {
    if (observerRef.current) return;
    setRequests([]);
    setSessionStats({ totalBytes: 0, totalRequests: 0, externalBytes: 0 });
    setIsMonitoring(true);

    observerRef.current = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const newRequests = entries
        .filter(e => e.entryType === 'resource')
        .map(e => {
          const classification = classifyRequest(e.name);
          const isExternal = classification.category !== 'local';
          return {
            id: `${e.name}-${e.startTime}`,
            url: e.name,
            type: e.initiatorType,
            size: e.transferSize || 0,
            duration: Math.round(e.duration),
            timestamp: new Date(performance.timeOrigin + e.startTime).toLocaleTimeString(),
            ...classification,
            isExternal,
          };
        });

      if (newRequests.length > 0) {
        setRequests(prev => [...newRequests, ...prev].slice(0, 200));
        setSessionStats(prev => ({
          totalBytes: prev.totalBytes + newRequests.reduce((s, r) => s + r.size, 0),
          totalRequests: prev.totalRequests + newRequests.length,
          externalBytes: prev.externalBytes + newRequests.filter(r => r.isExternal && r.risk !== 'low').reduce((s, r) => s + r.size, 0),
        }));
      }
    });

    try {
      observerRef.current.observe({ type: 'resource', buffered: true });
    } catch (e) {
      console.warn('PerformanceObserver not supported:', e);
    }
  }, []);

  const stopMonitoring = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    setIsMonitoring(false);
  }, []);

  const clearRequests = useCallback(() => {
    setRequests([]);
    setSessionStats({ totalBytes: 0, totalRequests: 0, externalBytes: 0 });
    if (typeof performance.clearResourceTimings === 'function') {
      performance.clearResourceTimings();
    }
  }, []);

  useEffect(() => {
    startMonitoring();
    return stopMonitoring;
  }, []);

  // FIXED: genuinely unexpected calls only (not CDN assets, not model downloads)
  const suspiciousRequests = requests.filter(r =>
    r.risk === 'high' || r.risk === 'critical'
  );

  const telemetryRequests = requests.filter(r => r.risk === 'critical');
  const modelDownloadRequests = requests.filter(r => r.category === 'model_download');

  return {
    requests,
    suspiciousRequests,
    telemetryRequests,
    modelDownloadRequests,
    isMonitoring,
    sessionStats,
    startMonitoring,
    stopMonitoring,
    clearRequests,
  };
}
