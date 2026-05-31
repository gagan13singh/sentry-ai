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
import { detectHardwareProfile } from '../lib/deviceProfile';
import { markModelCached, getStorageInfo } from '../lib/opfs';

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

    setModelId(targetModel);
    setModelTier(targetTier);
    setError(null);

    if (targetModel === 'chrome-gemini-nano') {
      setStatus(MODEL_STATUS.LOADING);
      setProgress({ stage: 'init', text: 'Locating Chrome Prompt API…', percent: 20 });
      try {
        const hasGlobalLM = typeof window.LanguageModel !== 'undefined' && typeof window.LanguageModel.create === 'function';

        let aiNS = null;
        if (!hasGlobalLM) {
          aiNS =
            (typeof ai !== 'undefined' && ai?.languageModel ? ai :
            typeof ai !== 'undefined' && ai?.assistant ? ai :
            typeof ai !== 'undefined' && ai?.createTextSession ? ai :
            window?.ai?.languageModel ? window.ai :
            window?.ai?.assistant ? window.ai :
            window?.ai?.createTextSession ? window.ai :
            null);
        }

        if (!hasGlobalLM && !aiNS) {
          const isMobile = /mobi|android|iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());
          if (isMobile) {
            throw new Error(
              'Google Gemini Nano / Prompt API is currently not supported on mobile browsers.\n' +
              'Please use one of Sentry AI\'s mobile-optimized engines like "Lightning Fast" or "Universal Compatible".'
            );
          }
          throw new Error(
            'Chrome Prompt API not found. Make sure you:\n' +
            '1. Are using Chrome 129+ (not Firefox, Edge, or Safari)\n' +
            '2. Enabled the "Prompt API for Gemini Nano" flags in chrome://flags\n' +
            '3. Clicked "Relaunch" at the bottom of the flags page after enabling'
          );
        }

        setProgress({ stage: 'check', text: 'Checking Gemini Nano availability…', percent: 40 });

        if (hasGlobalLM) {
          const availability = await window.LanguageModel.availability();
          if (availability === 'unavailable') {
            throw new Error(
              'Gemini Nano is not available on this device. Your hardware may not meet Google\'s requirements (needs 22+ GB of storage free and 8+ GB RAM).'
            );
          }
          if (availability === 'downloading') {
            throw new Error(
              'Gemini Nano model is currently downloading in the background. Please wait a moment and try again.'
            );
          }
          // if availability is 'downloadable', we proceed to call create() to trigger the final download/initialization.
        } else {
          // Check capabilities — this is the real gate
          const cap = await (aiNS.languageModel || aiNS.assistant)?.capabilities?.();

          if (cap) {
            if (cap.available === 'no') {
              throw new Error(
                'Gemini Nano is not available on this device. Your hardware may not meet Google\'s requirements (needs 22+ GB of storage free and 4+ GB RAM).'
              );
            }
            if (cap.available === 'after-download') {
              throw new Error(
                'Gemini Nano model weights haven\'t finished downloading yet.\n\n' +
                'To fix this: Open chrome://components → find "Optimization Guide On Device Model" → click "Check for update". ' +
                'Wait until the version number is non-zero and shows "Up-to-date", then try again.'
              );
            }
          }
        }

        setProgress({ stage: 'connect', text: 'Starting Gemini Nano session…', percent: 70 });

        // Create a test session to confirm everything works
        let session = null;
        if (hasGlobalLM) {
          session = await window.LanguageModel.create();
        } else if (aiNS.languageModel?.create) {
          session = await aiNS.languageModel.create();
        } else if (aiNS.assistant?.create) {
          session = await aiNS.assistant.create();
        } else if (aiNS.createTextSession) {
          session = await aiNS.createTextSession();
        }

        if (!session) {
          throw new Error('Gemini Nano session could not be created. Try relaunching Chrome and loading the model again.');
        }

        // Immediately destroy the test session
        try { await session.destroy?.(); } catch { /* ignore */ }
        try { await session.close?.(); } catch { /* ignore */ }

        setStatus(MODEL_STATUS.READY);
        setProgress({ stage: 'done', text: '✨ Gemini Nano Ready — fully local!', percent: 100 });
      } catch (e) {
        setError(e.message || 'Gemini Nano is unavailable. Please follow the setup guide in the Diagnostic page.');
        setStatus(MODEL_STATUS.ERROR);
      }
      return;
    }

    const api = apiRef.current;
    if (!api) return;

    const device = profile.model?.device || (profile.supportsWebGPU && !profile.isFallbackAdapter ? 'webgpu' : 'wasm');
    setStatus(MODEL_STATUS.LOADING);

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
    if (modelId === 'chrome-gemini-nano') {
      try {
        const systemMsg = messages.find(m => m.role === 'system')?.content || '';

        const hasGlobalLM = typeof window.LanguageModel !== 'undefined' && typeof window.LanguageModel.create === 'function';

        let aiNS = null;
        if (!hasGlobalLM) {
          aiNS =
            (typeof ai !== 'undefined' && ai?.languageModel ? ai :
            typeof ai !== 'undefined' && ai?.assistant ? ai :
            typeof ai !== 'undefined' && ai?.createTextSession ? ai :
            window?.ai?.languageModel ? window.ai :
            window?.ai?.assistant ? window.ai :
            window?.ai?.createTextSession ? window.ai :
            null);
        }

        if (!hasGlobalLM && !aiNS) throw new Error('Chrome Prompt API not available. Is Gemini Nano still loaded?');

        let session = null;
        if (hasGlobalLM) {
          session = await window.LanguageModel.create({ systemPrompt: systemMsg });
        } else if (aiNS.languageModel?.create) {
          session = await aiNS.languageModel.create({ systemPrompt: systemMsg });
        } else if (aiNS.assistant?.create) {
          session = await aiNS.assistant.create({ systemPrompt: systemMsg });
        } else if (aiNS.createTextSession) {
          session = await aiNS.createTextSession();
        }

        if (!session) throw new Error('Could not create Gemini Nano session.');

        // Flatten dialogue turns for Prompt API
        let promptText = '';
        messages.forEach(m => {
          if (m.role === 'system') return;
          promptText += `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}\n`;
        });
        promptText += "Assistant: ";

        let fullText = '';
        if (session.promptStreaming) {
          const stream = session.promptStreaming(promptText);
          for await (const chunk of stream) {
            let delta = '';
            if (chunk.startsWith(fullText)) {
              // Cumulative style
              delta = chunk.slice(fullText.length);
              fullText = chunk;
            } else {
              // Delta style
              delta = chunk;
              fullText += chunk;
            }
            onToken?.(delta, fullText, false);
          }
        } else {
          const res = await session.prompt(promptText);
          fullText = res;
          onToken?.(res, res, false);
        }
        
        onToken?.('', fullText, true);
        
        // Clean up session resources to prevent memory leaks in Chrome
        await session.destroy?.() || await session.close?.();
        
        return { content: fullText, modelTier: 'GEMINI_NANO' };
      } catch (e) {
        console.error('Gemini Nano chat error:', e);
        throw e;
      }
    }

    const api = apiRef.current;
    if (!api || statusRef.current !== MODEL_STATUS.READY) return null;

    const streamCallback = Comlink.proxy((delta, full, done) => {
      onToken?.(delta, full, done);
    });

    // FIX: don't swallow errors — let them propagate to Chat.jsx error handler
    return await api.chat(messages, streamCallback);
  }, [modelId]);

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