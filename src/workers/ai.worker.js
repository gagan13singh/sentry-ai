// ================================================================
// AI WORKER — Sentry AI Brain
// WebGPU mode  → WebLLM (Llama 3.2 1B/3B)
// CPU/WASM mode → Transformers.js ONNX (Qwen2.5 0.5B) — real CPU, no GPU needed
// Pipeline memory manager — unloads unused models to prevent OOM
// Threat scan pipeline (content safety check, local only)
// ================================================================

import { CreateMLCEngine } from '@mlc-ai/web-llm';
import { pipeline, env, TextStreamer } from '@huggingface/transformers';
import * as Comlink from 'comlink';

env.allowRemoteModels = true;
env.allowLocalModels = false; // FIXED: prevent Vercel SPA catch-all from serving index.html for /models/... paths
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
// WebGPU engine (WebLLM)
let llmEngine = null;
// CPU/WASM engine (Transformers.js) — used when WebGPU is absent
let wasmEngine = null;
let currentModelId = null;
let isLoading = false;
let currentDevice = 'webgpu';

// The ONNX model used for CPU/WASM mode (no WebGPU needed)
const WASM_HF_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';

// ── WebGPU engine (WebLLM) ─────────────────────────────────────────
async function initWebGPUEngine(modelId, onProgress) {
  if (llmEngine && currentModelId === modelId) return { success: true, cached: true };
  if (isLoading) return { success: false, error: 'Already loading' };

  isLoading = true;
  currentModelId = modelId;
  currentDevice = 'webgpu';

  try {
    llmEngine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        onProgress({ stage: 'llm', text: report.text, progress: report.progress });
      },
      logLevel: 'SILENT',
    });
    isLoading = false;
    return { success: true, cached: false, device: 'webgpu' };
  } catch (err) {
    isLoading = false;
    llmEngine = null;
    currentModelId = null;
    return { success: false, error: err.message };
  }
}

// ── CPU/WASM engine (Transformers.js ONNX) ────────────────────────
// Genuinely runs on CPU — no WebGPU required. Works on all devices.
async function initWASMEngine(onProgress) {
  if (wasmEngine) return { success: true, cached: true };
  if (isLoading) return { success: false, error: 'Already loading' };

  isLoading = true;
  currentDevice = 'wasm';

  try {
    wasmEngine = await pipeline('text-generation', WASM_HF_MODEL, {
      dtype: 'q4',
      device: 'cpu',
      progress_callback: (p) => {
        if (p.status === 'progress') {
          onProgress({
            stage: 'llm',
            text: `Loading ${p.file || 'model'}…`,
            progress: (p.progress ?? 0) / 100,
          });
        }
      },
    });
    isLoading = false;
    return { success: true, cached: false, device: 'wasm' };
  } catch (err) {
    isLoading = false;
    wasmEngine = null;
    return { success: false, error: err.message };
  }
}

// ── Worker API ─────────────────────────────────────────────────────
const api = {
  async loadModel(modelId, device = 'webgpu', onProgress) {
    if (device === 'wasm') {
      // Use Transformers.js ONNX — real CPU, no WebGPU needed
      return await initWASMEngine(onProgress);
    }
    return await initWebGPUEngine(modelId, onProgress);
  },

  async chat(messages, streamCallback) {
    // ── WASM path (Transformers.js) ──
    if (wasmEngine) {
      let accumulated = '';
      const streamer = new TextStreamer(wasmEngine.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
          accumulated += text;
          streamCallback(text, accumulated, false);
        },
      });
      await wasmEngine(messages, {
        max_new_tokens: 1024,
        do_sample: true,
        temperature: 0.7,
        streamer,
      });
      streamCallback('', accumulated, true);
      return { content: accumulated };
    }

    // ── WebGPU path (WebLLM) ──
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
      if (delta) { full += delta; streamCallback(delta, full, false); }
    }
    streamCallback('', full, true);
    return { content: full };
  },

  async chatSync(messages) {
    // ── WASM path ──
    if (wasmEngine) {
      const result = await wasmEngine(messages, {
        max_new_tokens: 512,
        do_sample: false,
        temperature: 0.1,
      });
      const content = result[0]?.generated_text?.at?.(-1)?.content
        ?? result[0]?.generated_text ?? '';
      return { content };
    }
    // ── WebGPU path ──
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
    const scanMessages = [
      {
        role: 'system',
        content: `You are a content safety classifier. Respond ONLY with JSON: {"safe": bool, "category": string, "confidence": 0-1}.
Categories: "prompt_injection", "jailbreak_attempt", "pii_exfiltration", "malware_request", "safe".
Be conservative — only flag clear violations.`,
      },
      { role: 'user', content: `Classify this text: """${text.slice(0, 500)}"""` },
    ];
    try {
      // WASM path
      if (wasmEngine) {
        const result = await wasmEngine(scanMessages, { max_new_tokens: 80, do_sample: false });
        const raw = (result[0]?.generated_text?.at?.(-1)?.content ?? '').trim();
        const json = JSON.parse(raw.match(/\{.*\}/s)?.[0] || '{}');
        return { safe: json.safe !== false, category: json.category || 'safe', confidence: json.confidence || 0 };
      }
      // WebGPU path
      if (!llmEngine) return { safe: true, reason: 'no model' };
      const reply = await llmEngine.chat.completions.create({
        messages: scanMessages, temperature: 0.0, max_tokens: 80,
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
      llmLoaded: !!llmEngine || !!wasmEngine,
      activePipelines: Object.keys(activePipelines),
      currentModelId,
      currentDevice,
      isLoading,
    };
  },

  async reset() {
    if (llmEngine) { try { await llmEngine.unload(); } catch (_) { } }
    if (wasmEngine) { try { await wasmEngine.dispose?.(); } catch (_) { } }
    for (const p of Object.values(activePipelines)) {
      try { await p.instance.dispose?.(); } catch (_) { }
    }
    activePipelines = {};
    llmEngine = null;
    wasmEngine = null;
    currentModelId = null;
    return { success: true };
  },
};

Comlink.expose(api);
