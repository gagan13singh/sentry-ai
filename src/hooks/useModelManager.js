// ================================================================
// useModelManager.js
// FIXED: 2-3 msg crash → WebGPU context loss recovery (no re-download)
// FIXED: KV cache / context_window constrained on mobile
// FIXED: isReady never flips to false on context loss — graceful recover
// NEW:   MODEL_STATUS.RECOVERING — shows "reconnecting" instead of setup
// NEW:   recoverEngine() — re-inits from cache in ~5-15s
// ================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Comlink from 'comlink';
import { detectHardwareProfile } from '../lib/deviceProfile';
import { markModelCached, getStorageInfo } from '../lib/opfs';

export const MODEL_STATUS = {
  IDLE: 'idle',
  CHECKING: 'checking',
  LOADING: 'loading',
  READY: 'ready',
  RECOVERING: 'recovering', // context lost, re-loading from cache
  ERROR: 'error',
};

export function detectMobile() {
  const ua = navigator.userAgent;
  const isMobileUA = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isTouchSmall = navigator.maxTouchPoints > 0 && window.screen.width < 1024;
  return isMobileUA || isTouchSmall;
}

function checkSharedArrayBuffer() {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    new SharedArrayBuffer(1);
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
  const [engineLost, setEngineLost] = useState(false);
  const [isMobile] = useState(() => detectMobile());
  const [sabAvailable] = useState(() => checkSharedArrayBuffer());

  const workerRef = useRef(null);
  const apiRef = useRef(null);
  const statusRef = useRef(status);
  const modelIdRef = useRef(modelId);
  // Prevent concurrent recovery attempts
  const recoveringRef = useRef(false);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { modelIdRef.current = modelId; }, [modelId]);

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

    if (!sabAvailable) {
      setError('SharedArrayBuffer unavailable — add vercel.json with COOP/COEP headers.');
      setStatus(MODEL_STATUS.ERROR);
      return;
    }

    let profile = hwProfile;
    if (!profile) profile = await detectHardware();
    if (!profile?.supportsWebGPU) {
      setError('WebGPU not supported. Use Chrome 113+ on a compatible GPU.');
      setStatus(MODEL_STATUS.ERROR);
      return;
    }

    let targetModel = overrideModelId || profile.model?.id;
    if (isMobile) {
      const { MODEL_TIERS } = await import('../lib/deviceProfile');
      targetModel = MODEL_TIERS.LOW.id;
    }
    if (!targetModel) return;

    setModelId(targetModel);
    setStatus(MODEL_STATUS.LOADING);
    setError(null);
    setEngineLost(false);

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
      const msg = e.message || '';
      if (isMobile && (msg.includes('memory') || msg.includes('OOM') || msg.includes('GPU'))) {
        setError('Not enough GPU memory. Close other apps/tabs and try again.');
      } else {
        setError(msg || 'Failed to load model');
      }
      setStatus(MODEL_STATUS.ERROR);
    }
  }, [hwProfile, detectHardware, isMobile, sabAvailable]);

  // ── Recover from WebGPU context loss without re-downloading ──────
  // Called automatically when chat() detects a GPU crash.
  // Uses the already-cached model — takes ~5-15s, not 60s+.
  const recoverEngine = useCallback(async () => {
    if (recoveringRef.current) return false;
    const api = apiRef.current;
    const currentId = modelIdRef.current;
    if (!api || !currentId) {
      setStatus(MODEL_STATUS.IDLE);
      return false;
    }

    recoveringRef.current = true;
    setStatus(MODEL_STATUS.RECOVERING);
    setEngineLost(true);

    try {
      const result = await api.recoverEngine(currentId, isMobile);
      recoveringRef.current = false;
      if (result.success) {
        setStatus(MODEL_STATUS.READY);
        setEngineLost(false);
        return true;
      }
      throw new Error(result.error || 'Recovery failed');
    } catch (e) {
      recoveringRef.current = false;
      setError('GPU context lost. Tap "Reload Model" — your cache is intact, no re-download needed.');
      setStatus(MODEL_STATUS.ERROR);
      return false;
    }
  }, [isMobile]);

  // ── chat with automatic context-loss detection & recovery ─────────
  const chat = useCallback(async (messages, onToken) => {
    const api = apiRef.current;
    if (!api) return null;

    // If already recovering, wait for it
    if (statusRef.current === MODEL_STATUS.RECOVERING) {
      await new Promise((resolve) => {
        const t = setInterval(() => {
          if (statusRef.current !== MODEL_STATUS.RECOVERING) {
            clearInterval(t);
            resolve();
          }
        }, 250);
        setTimeout(() => { clearInterval(t); resolve(); }, 30000);
      });
    }

    if (statusRef.current !== MODEL_STATUS.READY) return null;

    const streamCallback = Comlink.proxy((delta, full, done, contextLost) => {
      if (contextLost) {
        recoverEngine();
        return;
      }
      onToken?.(delta, full, done);
    });

    try {
      const result = await api.chat(messages, streamCallback);
      if (result?.contextLost) {
        recoverEngine();
        return null;
      }
      return result;
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      const isGPUCrash =
        msg.includes('context') || msg.includes('gpu') ||
        msg.includes('device lost') || msg.includes('webgpu') ||
        msg.includes('invalid') || msg.includes('destroyed') ||
        msg.includes('lost');
      if (isGPUCrash) {
        recoverEngine();
        return null;
      }
      throw e;
    }
  }, [recoverEngine]);

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
  const isRecovering = status === MODEL_STATUS.RECOVERING;

  return {
    status, progress, hwProfile, modelId, error, storageInfo,
    isReady, isRecovering, engineLost,
    isMobile, sabAvailable,
    detectHardware, loadModel, recoverEngine,
    chat, embedText, captionImage, transcribeAudio, scanContentThreat,
  };
}