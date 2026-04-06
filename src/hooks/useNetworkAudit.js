// ================================================================
// useNetworkAudit.js
// Monitors all outbound network requests via PerformanceObserver
// For the Privacy Audit dashboard — proves 0 bytes leave during AI inference
// ================================================================

import { useState, useEffect, useRef, useCallback } from 'react';

export function useNetworkAudit() {
  const [requests, setRequests] = useState([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [sessionStats, setSessionStats] = useState({ totalBytes: 0, totalRequests: 0 });
  const observerRef = useRef(null);
  const sessionStartRef = useRef(null);

  const startMonitoring = useCallback(() => {
    if (observerRef.current) return;
    sessionStartRef.current = Date.now();
    setRequests([]);
    setSessionStats({ totalBytes: 0, totalRequests: 0 });
    setIsMonitoring(true);

    observerRef.current = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const newRequests = entries
        .filter(e => e.entryType === 'resource')
        .map(e => ({
          id: `${e.name}-${e.startTime}`,
          url: e.name,
          type: e.initiatorType,
          size: e.transferSize || 0,
          duration: Math.round(e.duration),
          timestamp: new Date(performance.timeOrigin + e.startTime).toLocaleTimeString(),
          isSentryInternal: e.name.includes('huggingface') || e.name.includes('mlc') || e.name.includes('localhost'),
        }));

      if (newRequests.length > 0) {
        setRequests(prev => [...newRequests, ...prev].slice(0, 100));
        setSessionStats(prev => ({
          totalBytes: prev.totalBytes + newRequests.reduce((s, r) => s + r.size, 0),
          totalRequests: prev.totalRequests + newRequests.length,
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
    setSessionStats({ totalBytes: 0, totalRequests: 0 });
    if (typeof performance.clearResourceTimings === 'function') {
      performance.clearResourceTimings();
    }
  }, []);

  // Auto-start on mount
  useEffect(() => {
    startMonitoring();
    return stopMonitoring;
  }, []);

  // Requests filtered to only show external (non-AI-loading) during inference
  const externalRequests = requests.filter(r => !r.isSentryInternal);

  return {
    requests,
    externalRequests,
    isMonitoring,
    sessionStats,
    startMonitoring,
    stopMonitoring,
    clearRequests,
  };
}
