// ================================================================
// useModelManager.js
// Central hook that manages AI worker lifecycle, model loading,
// chat, embeddings, and all AI operations across the app
// ================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Comlink from 'comlink';
import { detectHardwareProfile } from '../lib/deviceProfile';
import { isModelCached, markModelCached, getStorageInfo } from '../lib/opfs';

export const MODEL_STATUS = {
  IDLE:     'idle',
  CHECKING: 'checking',
  LOADING:  'loading',
  READY:    'ready',
  ERROR:    'error',
};

export function useModelManager() {
  const [status, setStatus]           = useState(MODEL_STATUS.IDLE);
  const [progress, setProgress]       = useState({ stage: '', text: '', percent: 0 });
  const [hwProfile, setHwProfile]     = useState(null);
  const [modelId, setModelId]         = useState(null);
  const [error, setError]             = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);

  const workerRef = useRef(null);
  const apiRef    = useRef(null);

  // ── Boot worker ───────────────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/ai.worker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;
    apiRef.current    = Comlink.wrap(worker);

    return () => {
      worker.terminate();
      workerRef.current = null;
      apiRef.current    = null;
    };
  }, []);

  // ── Detect hardware ───────────────────────────────────────────────
  const detectHardware = useCallback(async () => {
    setStatus(MODEL_STATUS.CHECKING);
    try {
      const profile = await detectHardwareProfile();
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
  }, []);

  // ── Load model ────────────────────────────────────────────────────
  const loadModel = useCallback(async (overrideModelId = null) => {
    const api = apiRef.current;
    if (!api) return;

    let profile = hwProfile;
    if (!profile) profile = await detectHardware();
    if (!profile?.supportsWebGPU) {
      setError('WebGPU is not supported on this device. Please use Chrome 113+ on a compatible GPU.');
      setStatus(MODEL_STATUS.ERROR);
      return;
    }

    const targetModel = overrideModelId || profile.model?.id;
    if (!targetModel) return;

    setModelId(targetModel);
    setStatus(MODEL_STATUS.LOADING);
    setError(null);

    const progressCallback = Comlink.proxy((p) => {
      setProgress({
        stage:   p.stage || 'llm',
        text:    p.text  || 'Loading model…',
        percent: Math.round((p.progress || 0) * 100),
      });
    });

    try {
      const result = await api.loadModel(targetModel, progressCallback);
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
      setError(e.message);
      setStatus(MODEL_STATUS.ERROR);
    }
  }, [hwProfile, detectHardware]);

  // ── Chat ──────────────────────────────────────────────────────────
  const chat = useCallback(async (messages, onToken) => {
    const api = apiRef.current;
    if (!api || status !== MODEL_STATUS.READY) return null;

    const streamCallback = Comlink.proxy((delta, full, done) => {
      onToken?.(delta, full, done);
    });

    return await api.chat(messages, streamCallback);
  }, [status]);

  // ── Embed ─────────────────────────────────────────────────────────
  const embedText = useCallback(async (text) => {
    const api = apiRef.current;
    if (!api) return null;
    return await api.embedText(text, Comlink.proxy(() => {}));
  }, []);

  // ── Caption image ─────────────────────────────────────────────────
  const captionImage = useCallback(async (imageInput) => {
    const api = apiRef.current;
    if (!api) return '';
    return await api.captionImage(imageInput, Comlink.proxy(() => {}));
  }, []);

  // ── Transcribe audio ──────────────────────────────────────────────
  const transcribeAudio = useCallback(async (audioData) => {
    const api = apiRef.current;
    if (!api) return '';
    return await api.transcribeAudio(audioData, Comlink.proxy(() => {}));
  }, []);

  const isReady = status === MODEL_STATUS.READY;

  return {
    status, progress, hwProfile, modelId, error, storageInfo, isReady,
    detectHardware, loadModel, chat, embedText, captionImage, transcribeAudio,
  };
}
