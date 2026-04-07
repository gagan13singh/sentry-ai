// ================================================================
// useModelManager.js
// FIXED: scanContentThreat exposed correctly via Comlink
// FIXED: stale closure protection on chat callback
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

export function useModelManager() {
  const [status, setStatus] = useState(MODEL_STATUS.IDLE);
  const [progress, setProgress] = useState({ stage: '', text: '', percent: 0 });
  const [hwProfile, setHwProfile] = useState(null);
  const [modelId, setModelId] = useState(null);
  const [error, setError] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);

  const workerRef = useRef(null);
  const apiRef = useRef(null);
  // FIXED: keep a stable ref to current status to avoid stale closures in chat callback
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

  const loadModel = useCallback(async (overrideModelId = null) => {
    const api = apiRef.current;
    if (!api) return;

    let profile = hwProfile;
    if (!profile) profile = await detectHardware();
    if (!profile?.supportsWebGPU) {
      setError('WebGPU is not supported. Please use Chrome 113+ on a compatible GPU.');
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
        stage: p.stage || 'llm',
        text: p.text || 'Loading model…',
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

  const chat = useCallback(async (messages, onToken) => {
    const api = apiRef.current;
    // FIXED: use ref not closure variable
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

  // NEW: local threat detection
  const scanContentThreat = useCallback(async (text) => {
    const api = apiRef.current;
    if (!api || statusRef.current !== MODEL_STATUS.READY) return { safe: true };
    return await api.scanContentThreat(text);
  }, []);

  const isReady = status === MODEL_STATUS.READY;

  return {
    status, progress, hwProfile, modelId, error, storageInfo, isReady,
    detectHardware, loadModel, chat, embedText, captionImage,
    transcribeAudio, scanContentThreat,
  };
}