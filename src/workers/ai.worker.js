// ================================================================
// AI WORKER — Sentry AI Brain
// Runs in a Web Worker to keep the UI thread free.
// Handles: WebLLM (text/vision), Transformers.js (audio/embeddings/captions)
// ================================================================

import { CreateMLCEngine } from '@mlc-ai/web-llm';
import { pipeline, env, AutoProcessor, AutoModelForImageClassification } from '@huggingface/transformers';
import * as Comlink from 'comlink';

// ── Transformers.js config ────────────────────────────────────────
// Allow remote models but prefer cached OPFS models
env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = true;

// ── State ──────────────────────────────────────────────────────────
let llmEngine = null;
let embedPipeline = null;
let captionPipeline = null;
let whisperPipeline = null;
let currentModelId = null;
let isLoading = false;

// ── Helpers ────────────────────────────────────────────────────────
function postProgress(type, data) {
  self.postMessage({ type, ...data });
}

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

// ── Embeddings Pipeline ────────────────────────────────────────────
async function initEmbeddings(onProgress) {
  if (embedPipeline) return;
  embedPipeline = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2',
    {
      progress_callback: (p) => {
        if (p.status === 'progress') onProgress({ stage: 'embed', progress: p.progress / 100, text: 'Loading embeddings model…' });
      },
      device: 'webgpu',
      dtype: 'fp16',
    }
  );
}

// ── Caption Pipeline ───────────────────────────────────────────────
async function initCaption(onProgress) {
  if (captionPipeline) return;
  captionPipeline = await pipeline(
    'image-to-text',
    'Xenova/vit-gpt2-image-captioning',
    {
      progress_callback: (p) => {
        if (p.status === 'progress') onProgress({ stage: 'caption', progress: p.progress / 100, text: 'Loading vision model…' });
      },
    }
  );
}

// ── Whisper Pipeline ───────────────────────────────────────────────
async function initWhisper(onProgress) {
  if (whisperPipeline) return;
  whisperPipeline = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-tiny.en',
    {
      progress_callback: (p) => {
        if (p.status === 'progress') onProgress({ stage: 'whisper', progress: p.progress / 100, text: 'Loading Whisper model…' });
      },
      device: 'webgpu',
      dtype: 'fp16',
    }
  );
}

// ── Worker API (exposed via Comlink) ───────────────────────────────
const api = {
  // Init the LLM with streaming progress via callback
  async loadModel(modelId, onProgress) {
    return await initLLM(modelId, onProgress);
  },

  // Streaming chat completion — yields tokens via streamCallback
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

  // Non-streaming chat (for RAG context building)
  async chatSync(messages) {
    if (!llmEngine) return { error: 'Model not loaded' };
    const reply = await llmEngine.chat.completions.create({
      messages,
      temperature: 0.3,
      max_tokens: 512,
    });
    return { content: reply.choices[0].message.content };
  },

  // Embed text → 384-dim Float32Array
  async embedText(texts, onProgress) {
    await initEmbeddings(onProgress || (() => { }));
    const output = await embedPipeline(Array.isArray(texts) ? texts : [texts], {
      pooling: 'mean',
      normalize: true,
    });
    // Return as plain arrays for Comlink transfer
    return Array.from(output.data);
  },

  // Caption an image from a base64 data URL or URL string
  async captionImage(imageInput, onProgress) {
    await initCaption(onProgress || (() => { }));
    const result = await captionPipeline(imageInput, { max_new_tokens: 100 });
    return result[0]?.generated_text || '';
  },

  // Transcribe audio from a Float32Array (Web Audio format)
  async transcribeAudio(audioData, onProgress) {
    await initWhisper(onProgress || (() => { }));
    const result = await whisperPipeline(audioData, {
      chunk_length_s: 30,
      return_timestamps: false,
    });
    return result.text || '';
  },

  // Get current model info
  getStatus() {
    return {
      llmLoaded: !!llmEngine,
      embedLoaded: !!embedPipeline,
      captionLoaded: !!captionPipeline,
      whisperLoaded: !!whisperPipeline,
      currentModelId,
      isLoading,
    };
  },

  // Reset engine (for model switching)
  async reset() {
    if (llmEngine) {
      try { await llmEngine.unload(); } catch (_) { }
    }
    llmEngine = null;
    currentModelId = null;
    return { success: true };
  },
};

Comlink.expose(api);
