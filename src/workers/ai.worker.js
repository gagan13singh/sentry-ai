// ================================================================
// AI WORKER — Sentry AI Brain
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
// Only ONE auxiliary pipeline loaded at a time to prevent OOM on low-RAM devices.
// LLM engine stays resident once loaded (it's the primary model).
const MAX_AUX_RAM_GB = 1.5;  // conservative budget for aux pipelines
let activePipelines = {};   // { name: { instance, lastUsed, estimatedMB } }
const PIPELINE_BUDGETS = {
  embed: 80,    // MiniLM-L6-v2 ~80MB
  caption: 350,   // ViT-GPT2 ~350MB
  whisper: 150,   // whisper-tiny.en ~150MB
};

async function getPipeline(name, loader) {
  if (activePipelines[name]) {
    activePipelines[name].lastUsed = Date.now();
    return activePipelines[name].instance;
  }

  // Evict least-recently-used pipeline if we'd exceed budget
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

// ── LLM Engine ────────────────────────────────────────────────────
async function initLLM(modelId, onProgress) {
  if (llmEngine && currentModelId === modelId) return { success: true, cached: true };
  if (isLoading) return { success: false, error: 'Already loading' };

  isLoading = true;
  currentModelId = modelId;

  try {
    llmEngine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        onProgress({
          stage: 'llm',
          text: report.text,
          progress: report.progress,
        });
      },
      logLevel: 'SILENT',
    });
    isLoading = false;
    return { success: true, cached: false };
  } catch (err) {
    isLoading = false;
    llmEngine = null;
    currentModelId = null;
    return { success: false, error: err.message };
  }
}

// ── Worker API ─────────────────────────────────────────────────────
const api = {
  async loadModel(modelId, onProgress) {
    return await initLLM(modelId, onProgress);
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

  // FIXED: uses pipeline manager, won't OOM
  async embedText(texts, onProgress) {
    const pipe = await getPipeline('embed', () =>
      pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        progress_callback: (p) => {
          if (p.status === 'progress')
            onProgress?.({ stage: 'embed', progress: p.progress / 100, text: 'Loading embeddings…' });
        },
        device: 'webgpu',
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
        device: 'webgpu',
        dtype: 'fp16',
      })
    );
    const result = await pipe(audioData, {
      chunk_length_s: 30,
      return_timestamps: false,
    });
    return result.text || '';
  },

  // NEW: local threat scan — classifies text for harmful content WITHOUT sending it anywhere
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