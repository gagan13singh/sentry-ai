// ================================================================
// deviceProfile.js — Hardware-Aware Model Selection
// Uses navigator.deviceMemory + WebGPU adapter info to pick model
// MODEL_TIERS exported as named export (used by useModelManager mobile override)
// ================================================================

export const MODEL_TIERS = {
  HIGH: {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 3B · High Quality',
    size: '2.1 GB',
    minRam: 8,
  },
  LOW: {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 1B · Efficient',
    size: '0.9 GB',
    minRam: 0,
  },
};

/**
 * Probes hardware capabilities and returns the best model config.
 */
export async function detectHardwareProfile() {
  // ── RAM detection ────────────────────────────────────────────────
  const ram = navigator.deviceMemory ?? 4;

  // ── WebGPU detection ─────────────────────────────────────────────
  let gpuInfo = null;
  let supportsWebGPU = false;

  if (typeof navigator.gpu !== 'undefined') {
    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (adapter) {
        supportsWebGPU = true;
        const info = adapter.info || await adapter.requestAdapterInfo?.() || {};
        gpuInfo = {
          vendor: info.vendor || 'Unknown',
          architecture: info.architecture || 'Unknown',
          device: info.device || 'Unknown',
          description: info.description || 'WebGPU GPU',
        };
      }
    } catch {
      supportsWebGPU = false;
    }
  }

  // ── Tier selection ───────────────────────────────────────────────
  let tier, model;
  if (!supportsWebGPU) {
    tier = 'NO_GPU';
    model = null;
  } else if (ram >= 8) {
    tier = 'HIGH';
    model = MODEL_TIERS.HIGH;
  } else {
    tier = 'LOW';
    model = MODEL_TIERS.LOW;
  }

  return { tier, model, ram, gpuInfo, supportsWebGPU };
}

/**
 * Returns all available model options for manual selection.
 */
export function getAllModels() {
  return Object.values(MODEL_TIERS);
}