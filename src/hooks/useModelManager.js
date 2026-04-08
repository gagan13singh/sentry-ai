// ================================================================
// useModelManager.js
//
// BUG FIXES:
// 1. Worker was created unconditionally in useEffect — if React StrictMode
//    fires the effect twice, two workers were created and the first leaked.
//    Now guarded with a ref so only one worker lives at a time.
// 2. `loadModel` had `hwProfile` in its deps but `hwProfile` changes after
//    `detectHardware()` returns — causing a brief window where the old
//    profile was used. Now reads the returned profile directly, not the state.
// 3. `chat` callback: if Comlink threw a structural-clone error on the proxy
//    callback, the rejection was silently swallowed. Now surfaces the error.
// 4. detectHardware: if called again while already running, a second request
//    would race the first and both would set status. Deduplicated with a ref.
// 5. Added model warmup call after successful load (primes GPU shader cache).
//
// IMPROVEMENTS:
// A. Exposed `resetModel()` so UI can unload and reload without page refresh.
// B. Added `modelInfo` state that reflects what the worker reports.
// ================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Comlink from 'comlink';
import { detectHardwareProfile, getModelTierFromId } from '../lib/deviceProfile';
import { isModelCached, markModelCached, getStorageInfo } from '../lib/opfs';

export const MODEL_STATUS = {
  IDLE: 'idle',
  CHECKING: 'checking',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
};

export function useModelManager() {
  const [status, setStatus] = useState(MODEL_STATUS.IDLE);
  const [progress, setProgress] = useState({ stage: '', text: '', percent: 0 });
  const [hwProfile, setHwProfile] = useState(null);
  const [modelId, setModelId] = useState(null);
  const [modelTier, setModelTier] = useState(null);
  const [error, setError] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);

  const workerRef = useRef(null);
  const apiRef = useRef(null);
  const statusRef = useRef(status);
  const detectingRef = useRef(false); // FIX: guard against concurrent detections
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    // FIX: only create worker if none exists (handles React StrictMode double-invoke)
    if (workerRef.current) return;

    const worker = new Worker(
      new URL('../workers/ai.worker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;
    apiRef.current = Comlink.wrap(worker);

    return () => {
      // Terminate on true unmount
      workerRef.current?.terminate();
      workerRef.current = null;
      apiRef.current = null;
    };
  }, []);

  const detectHardware = useCallback(async () => {
    // FIX: deduplicate concurrent detection calls
    if (detectingRef.current) return hwProfile;
    detectingRef.current = true;

    if (statusRef.current !== MODEL_STATUS.READY && statusRef.current !== MODEL_STATUS.LOADING) {
      setStatus(MODEL_STATUS.CHECKING);
    }
    try {
      const profile = await detectHardwareProfile();
      setHwProfile(profile);
      const info = await getStorageInfo();
      setStorageInfo(info);
      if (statusRef.current === MODEL_STATUS.CHECKING) {
        setStatus(MODEL_STATUS.IDLE);
      }
      return profile;
    } catch (e) {
      setError(e.message);
      if (statusRef.current === MODEL_STATUS.CHECKING) {
        setStatus(MODEL_STATUS.ERROR);
      }
      return null;
    } finally {
      detectingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadModel = useCallback(async (overrideModelId = null, overrideTier = null) => {
    const api = apiRef.current;
    if (!api) return;

    // FIX: always get a fresh profile — don't rely on potentially stale state
    let profile = await detectHardware();

    if (!profile) {
      setError('Could not detect hardware profile.');
      setStatus(MODEL_STATUS.ERROR);
      return;
    }

    const targetModel = overrideModelId || profile.model?.id;
    const targetTier = overrideTier || profile.tier;

    if (!targetModel) {
      setError('No compatible model found for this device.');
      setStatus(MODEL_STATUS.ERROR);
      return;
    }

    const device = profile.model?.device || (profile.supportsWebGPU && !profile.isFallbackAdapter ? 'webgpu' : 'wasm');

    setModelId(targetModel);
    setModelTier(targetTier);
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
      const result = await api.loadModel(targetModel, targetTier, device, progressCallback);
      if (result.success) {
        setStatus(MODEL_STATUS.READY);
        setProgress({ stage: 'done', text: 'Model ready', percent: 100 });
        await markModelCached(targetModel);
        const info = await getStorageInfo();
        setStorageInfo(info);

        // IMPROVEMENT: warm up shader cache (fire-and-forget, non-blocking)
        api.warmup().catch(() => { });
      } else {
        throw new Error(result.error || 'Unknown load error');
      }
    } catch (e) {
      setError(e.message);
      setStatus(MODEL_STATUS.ERROR);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectHardware]);

  // IMPROVEMENT: allow UI to reset/unload the model
  const resetModel = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    await api.reset();
    setStatus(MODEL_STATUS.IDLE);
    setProgress({ stage: '', text: '', percent: 0 });
    setModelId(null);
    setModelTier(null);
    setError(null);
  }, []);

  const chat = useCallback(async (messages, onToken) => {
    const api = apiRef.current;
    if (!api || statusRef.current !== MODEL_STATUS.READY) return null;

    const streamCallback = Comlink.proxy((delta, full, done) => {
      onToken?.(delta, full, done);
    });

    // FIX: don't swallow errors — let them propagate to Chat.jsx error handler
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
    status, progress, hwProfile, modelId, modelTier, error, storageInfo, isReady,
    detectHardware, loadModel, resetModel, chat, embedText, captionImage,
    transcribeAudio, scanContentThreat,
  };
}