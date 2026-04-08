// ================================================================
// useModelManager.js
// Enhanced with 5-tier model system and confidence tracking
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
  const [modelTier, setModelTier] = useState(null); // Track current model tier
  const [error, setError] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);

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
    }
  }, []);

  const loadModel = useCallback(async (overrideModelId = null, overrideTier = null) => {
    const api = apiRef.current;
    if (!api) return;

    let profile = hwProfile;
    if (!profile) profile = await detectHardware();

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

    // Determine device from profile (webgpu or wasm)
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
      // Pass model tier to worker for confidence tracking
      const result = await api.loadModel(targetModel, targetTier, device, progressCallback);
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
    status, progress, hwProfile, modelId, modelTier, error, storageInfo, isReady,
    detectHardware, loadModel, chat, embedText, captionImage,
    transcribeAudio, scanContentThreat,
  };
}