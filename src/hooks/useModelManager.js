// ================================================================
// useModelManager.js
// FIXED: Mobile crash at 100% — VRAM overflow + SharedArrayBuffer guard
// FIXED: Auto-detects mobile and forces 1B model + low_power_mode
// FIXED: stale closure protection on chat callback
// FIXED: scanContentThreat exposed correctly via Comlink
// NEW:   isMobile detection exported for UI hints
// ================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Comlink from 'comlink';
import { detectHardwareProfile } from '../lib/deviceProfile';
import { isModelCached, markModelCached, getStorageInfo } from '../lib/opfs';

export const MODEL_STATUS = {
  IDLE: 'idle',
  CHECKING: 'checking',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
};

// ── Mobile/tablet detection (conservative — includes iPads) ────────
export function detectMobile() {
  const ua = navigator.userAgent;
  const isMobileUA = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  // Also check touch + small screen as fallback
  const isTouchSmall = navigator.maxTouchPoints > 0 && window.screen.width < 1024;
  return isMobileUA || isTouchSmall;
}

// ── SharedArrayBuffer guard ─────────────────────────────────────────
function checkSharedArrayBuffer() {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    // Try actually creating one — some envs define but block it
    const _ = new SharedArrayBuffer(1);
    return true;
  } catch {
    return false;
  }
}

export function useModelManager() {
  const [status, setStatus] = useState(MODEL_STATUS.IDLE);
  const [progress, setProgress] = useState({ stage: '', text: '', percent: 0 });
  const [hwProfile, setHwProfile] = useState(null);
  const [modelId, setModelId] = useState(null);
  const [error, setError] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [isMobile] = useState(() => detectMobile());
  const [sabAvailable] = useState(() => checkSharedArrayBuffer());

  const workerRef = useRef(null);
  const apiRef = useRef(null);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/ai.worker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;
    apiRef.current = Comlink.wrap(worker);

    return () => {
      worker.terminate();
      workerRef.current = null;
      apiRef.current = null;
    };
  }, []);

  const detectHardware = useCallback(async () => {
    setStatus(MODEL_STATUS.CHECKING);
    try {
      const profile = await detectHardwareProfile();
      // Override model choice for mobile — force 1B to avoid VRAM crash
      if (isMobile && profile.model) {
        const { MODEL_TIERS } = await import('../lib/deviceProfile');
        profile.model = MODEL_TIERS.LOW;
        profile.mobileOverride = true;
      }
      setHwProfile(profile);
      const info = await getStorageInfo();
      setStorageInfo(info);
      setStatus(MODEL_STATUS.IDLE);
      return profile;
    } catch (e) {
      setError(e.message);
      setStatus(MODEL_STATUS.ERROR);
      return null;
    }
  }, [isMobile]);

  const loadModel = useCallback(async (overrideModelId = null) => {
    const api = apiRef.current;
    if (!api) return;

    // Guard: SharedArrayBuffer required for WebLLM
    if (!sabAvailable) {
      setError(
        'Your browser requires Cross-Origin Isolation headers to run local AI. ' +
        'If self-hosting, ensure your server sends: ' +
        'Cross-Origin-Opener-Policy: same-origin and ' +
        'Cross-Origin-Embedder-Policy: require-corp'
      );
      setStatus(MODEL_STATUS.ERROR);
      return;
    }

    let profile = hwProfile;
    if (!profile) profile = await detectHardware();
    if (!profile?.supportsWebGPU) {
      setError('WebGPU is not supported. Please use Chrome 113+ on a compatible GPU.');
      setStatus(MODEL_STATUS.ERROR);
      return;
    }

    // On mobile: always use the 1B model regardless of override to prevent OOM crash
    let targetModel = overrideModelId || profile.model?.id;
    if (isMobile) {
      const { MODEL_TIERS } = await import('../lib/deviceProfile');
      targetModel = MODEL_TIERS.LOW.id;
    }
    if (!targetModel) return;

    setModelId(targetModel);
    setStatus(MODEL_STATUS.LOADING);
    setError(null);

    const progressCallback = Comlink.proxy((p) => {
      setProgress({
        stage: p.stage || 'llm',
        text: p.text || 'Loading model…',
        percent: Math.round((p.progress || 0) * 100),
      });
    });

    try {
      const result = await api.loadModel(targetModel, progressCallback, isMobile);
      if (result.success) {
        setStatus(MODEL_STATUS.READY);
        setProgress({ stage: 'done', text: 'Model ready', percent: 100 });
        await markModelCached(targetModel);
        const info = await getStorageInfo();
        setStorageInfo(info);
      } else {
        throw new Error(result.error || 'Unknown load error');
      }
    } catch (e) {
      // Friendly mobile-specific error message
      const msg = e.message || '';
      if (isMobile && (msg.includes('memory') || msg.includes('OOM') || msg.includes('GPU'))) {
        setError(
          'Not enough GPU memory on this device. Try closing other apps and tabs, ' +
          'then reload the page to try again.'
        );
      } else {
        setError(msg || 'Failed to load model');
      }
      setStatus(MODEL_STATUS.ERROR);
    }
  }, [hwProfile, detectHardware, isMobile, sabAvailable]);

  const chat = useCallback(async (messages, onToken) => {
    const api = apiRef.current;
    if (!api || statusRef.current !== MODEL_STATUS.READY) return null;

    const streamCallback = Comlink.proxy((delta, full, done) => {
      onToken?.(delta, full, done);
    });

    return await api.chat(messages, streamCallback);
  }, []);

  const embedText = useCallback(async (text) => {
    const api = apiRef.current;
    if (!api) return null;
    return await api.embedText(text, Comlink.proxy(() => { }));
  }, []);

  const captionImage = useCallback(async (imageInput) => {
    const api = apiRef.current;
    if (!api) return '';
    return await api.captionImage(imageInput, Comlink.proxy(() => { }));
  }, []);

  const transcribeAudio = useCallback(async (audioData) => {
    const api = apiRef.current;
    if (!api) return '';
    return await api.transcribeAudio(audioData, Comlink.proxy(() => { }));
  }, []);

  const scanContentThreat = useCallback(async (text) => {
    const api = apiRef.current;
    if (!api || statusRef.current !== MODEL_STATUS.READY) return { safe: true };
    return await api.scanContentThreat(text);
  }, []);

  const isReady = status === MODEL_STATUS.READY;

  return {
    status, progress, hwProfile, modelId, error, storageInfo, isReady,
    isMobile, sabAvailable,
    detectHardware, loadModel, chat, embedText, captionImage,
    transcribeAudio, scanContentThreat,
  };
}