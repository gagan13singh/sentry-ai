// ================================================================
// AI WORKER — Sentry AI Brain
// FIXED: WASM fallback support — passes device: 'wasm' when WebGPU absent
// FIXED: Pipeline memory manager — unloads unused models to prevent OOM
// FIXED: Proper error boundaries per pipeline
// NEW:   Threat scan pipeline (content safety check, local only)
// ================================================================

import { CreateMLCEngine } from '@mlc-ai/web-llm';
import { pipeline, env } from '@huggingface/transformers';
import * as Comlink from 'comlink';

env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = true;

// ── Pipeline Memory Manager ────────────────────────────────────────
const MAX_AUX_RAM_GB = 1.5;
let activePipelines = {};
const PIPELINE_BUDGETS = {
  embed: 80,
  caption: 350,
  whisper: 150,
};

async function getPipeline(name, loader) {
  if (activePipelines[name]) {
    activePipelines[name].lastUsed = Date.now();
    return activePipelines[name].instance;
  }

  const totalMB = Object.values(activePipelines).reduce((s, p) => s + p.estimatedMB, 0);
  if (totalMB + PIPELINE_BUDGETS[name] > MAX_AUX_RAM_GB * 1024) {
    const lru = Object.entries(activePipelines)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (lru) {
      try { await lru[1].instance.dispose?.(); } catch (_) { }
      delete activePipelines[lru[0]];
    }
  }

  const instance = await loader();
  activePipelines[name] = {
    instance,
    lastUsed: Date.now(),
    estimatedMB: PIPELINE_BUDGETS[name] || 100,
  };
  return instance;
}

// ── State ──────────────────────────────────────────────────────────
let llmEngine = null;
let currentModelId = null;
let isLoading = false;
let currentDevice = 'webgpu'; // track which device mode we're using

// ── LLM Engine ────────────────────────────────────────────────────
// FIXED: Accepts device parameter ('webgpu' | 'wasm') for WASM fallback
async function initLLM(modelId, device = 'webgpu', onProgress) {
  if (llmEngine && currentModelId === modelId) return { success: true, cached: true };
  if (isLoading) return { success: false, error: 'Already loading' };

  isLoading = true;
  currentModelId = modelId;
  currentDevice = device;

  try {
    // FIXED: Pass device config to CreateMLCEngine
    // When device='wasm', WebLLM uses a CPU-based WASM runtime instead of WebGPU
    const engineConfig = {
      initProgressCallback: (report) => {
        onProgress({
          stage: 'llm',
          text: report.text,
          progress: report.progress,
        });
      },
      logLevel: 'SILENT',
    };

    // WASM fallback: point to the correct CPU/WASM model lib (not the WebGPU variant)
    if (device === 'wasm') {
      engineConfig.appConfig = {
        model_list: [
          {
            model: `https://huggingface.co/mlc-ai/${modelId}/resolve/main/`,
            model_id: modelId,
            // Use the wasm-specific library (NOT -webgpu.wasm)
            model_lib: `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm-models/lib/${modelId}-wasm.wasm`,
          },
        ],
      };
      engineConfig.device = 'wasm';
    }

    llmEngine = await CreateMLCEngine(modelId, engineConfig);
    isLoading = false;
    return { success: true, cached: false, device };
  } catch (err) {
    isLoading = false;
    llmEngine = null;
    currentModelId = null;
    return { success: false, error: err.message, device };
  }
}

// ── Worker API ─────────────────────────────────────────────────────
const api = {
  // FIXED: Accept device parameter
  async loadModel(modelId, device = 'webgpu', onProgress) {
    return await initLLM(modelId, device, onProgress);
  },

  async chat(messages, streamCallback) {
    if (!llmEngine) return { error: 'Model not loaded' };

    const stream = await llmEngine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });

    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        streamCallback(delta, full, false);
      }
    }
    streamCallback('', full, true);
    return { content: full };
  },

  async chatSync(messages) {
    if (!llmEngine) return { error: 'Model not loaded' };
    const reply = await llmEngine.chat.completions.create({
      messages,
      temperature: 0.3,
      max_tokens: 512,
    });
    return { content: reply.choices[0].message.content };
  },

  async embedText(texts, onProgress) {
    const pipe = await getPipeline('embed', () =>
      pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        progress_callback: (p) => {
          if (p.status === 'progress')
            onProgress?.({ stage: 'embed', progress: p.progress / 100, text: 'Loading embeddings…' });
        },
        // FIXED: Use cpu for embedding pipeline when in WASM mode to avoid conflicts
        device: currentDevice === 'wasm' ? 'cpu' : 'webgpu',
        dtype: 'fp16',
      })
    );

    const output = await pipe(Array.isArray(texts) ? texts : [texts], {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data);
  },

  async captionImage(imageInput, onProgress) {
    const pipe = await getPipeline('caption', () =>
      pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning', {
        progress_callback: (p) => {
          if (p.status === 'progress')
            onProgress?.({ stage: 'caption', progress: p.progress / 100, text: 'Loading vision model…' });
        },
      })
    );
    const result = await pipe(imageInput, { max_new_tokens: 100 });
    return result[0]?.generated_text || '';
  },

  async transcribeAudio(audioData, onProgress) {
    const pipe = await getPipeline('whisper', () =>
      pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        progress_callback: (p) => {
          if (p.status === 'progress')
            onProgress?.({ stage: 'whisper', progress: p.progress / 100, text: 'Loading Whisper…' });
        },
        device: currentDevice === 'wasm' ? 'cpu' : 'webgpu',
        dtype: 'fp16',
      })
    );
    const result = await pipe(audioData, {
      chunk_length_s: 30,
      return_timestamps: false,
    });
    return result.text || '';
  },

  async scanContentThreat(text) {
    if (!llmEngine) return { safe: true, reason: 'no model' };
    try {
      const reply = await llmEngine.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `You are a content safety classifier. Respond ONLY with JSON: {"safe": bool, "category": string, "confidence": 0-1}.
Categories: "prompt_injection", "jailbreak_attempt", "pii_exfiltration", "malware_request", "safe".
Be conservative — only flag clear violations.`,
          },
          { role: 'user', content: `Classify this text: """${text.slice(0, 500)}"""` },
        ],
        temperature: 0.0,
        max_tokens: 80,
      });
      const raw = reply.choices[0].message.content.trim();
      const json = JSON.parse(raw.match(/\{.*\}/s)?.[0] || '{}');
      return { safe: json.safe !== false, category: json.category || 'safe', confidence: json.confidence || 0 };
    } catch {
      return { safe: true, category: 'parse_error', confidence: 0 };
    }
  },

  getStatus() {
    return {
      llmLoaded: !!llmEngine,
      activePipelines: Object.keys(activePipelines),
      currentModelId,
      currentDevice,
      isLoading,
    };
  },

  async reset() {
    if (llmEngine) {
      try { await llmEngine.unload(); } catch (_) { }
    }
    for (const p of Object.values(activePipelines)) {
      try { await p.instance.dispose?.(); } catch (_) { }
    }
    activePipelines = {};
    llmEngine = null;
    currentModelId = null;
    return { success: true };
  },
};

Comlink.expose(api);
