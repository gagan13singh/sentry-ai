// ================================================================
// deviceProfile.js — Hardware-Aware Model Selection
// FIXED: Added WASM fallback tier for devices without WebGPU
// FIXED: isFallbackAdapter detection for budget Android phones
// FIXED: SharedArrayBuffer availability check (COOP/COEP requirement)
// ================================================================

export const MODEL_TIERS = {
  HIGH: {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 3B · High Quality',
    shortLabel: 'Sentry Turbo',
    tagline: 'AI engine #1 — best for complex reasoning',
    size: '2.1 GB',
    icon: '⚡',
    minRam: 8,
    device: 'webgpu',
  },
  LOW: {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 1B · Efficient',
    shortLabel: 'Sentry Lite',
    tagline: 'Privacy-first — great for battery & older devices',
    size: '0.9 GB',
    icon: '🍃',
    minRam: 0,
    device: 'webgpu',
  },
  // WASM fallback for devices without WebGPU (e.g. Realme, older Android)
  WASM: {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 · 0.5B · CPU/WASM Mode',
    shortLabel: 'Sentry CPU',
    tagline: 'Runs on any device — no GPU required',
    size: '0.4 GB',
    icon: '🧠',
    minRam: 0,
    device: 'wasm',
    isFallback: true,
  },
};

/**
 * Probes hardware capabilities and returns the best model config.
 * @returns {Promise<{tier, model, ram, gpuInfo, supportsWebGPU, isFallbackAdapter, hasSharedArrayBuffer, warnings}>}
 */
export async function detectHardwareProfile() {
  const warnings = [];

  // ── SharedArrayBuffer check (COOP/COEP headers required by WebLLM) ──
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  if (!hasSharedArrayBuffer) {
    warnings.push({
      type: 'missing_sab',
      message: 'SharedArrayBuffer unavailable — COOP/COEP headers missing. WebLLM will fail silently. Deploy with Cross-Origin-Isolation headers.',
      severity: 'critical',
    });
  }

  // ── RAM detection ────────────────────────────────────────────────
  const ram = navigator.deviceMemory ?? 4;

  // ── WebGPU detection ─────────────────────────────────────────────
  let gpuInfo = null;
  let supportsWebGPU = false;
  let isFallbackAdapter = false;

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

        // FIXED: Detect software/fallback adapters (common on budget Android)
        // isFallbackAdapter means it's a CPU-emulated WebGPU — too slow for 3B models
        isFallbackAdapter = !!(
          adapter.isFallbackAdapter ||
          (info.vendor || '').toLowerCase().includes('google') && (info.architecture || '').toLowerCase().includes('swiftshader') ||
          (info.description || '').toLowerCase().includes('llvmpipe') ||
          (info.description || '').toLowerCase().includes('softpipe') ||
          (info.description || '').toLowerCase().includes('swiftshader')
        );

        if (isFallbackAdapter) {
          warnings.push({
            type: 'fallback_adapter',
            message: 'WebGPU is running in software emulation mode (SwiftShader/LLVMPipe). Performance will be very slow. CPU/WASM mode recommended.',
            severity: 'warning',
          });
        }
      }
    } catch (e) {
      supportsWebGPU = false;
    }
  }

  // ── Tier selection ───────────────────────────────────────────────
  let tier, model;

  if (!supportsWebGPU || isFallbackAdapter || !hasSharedArrayBuffer) {
    // FIXED: Fall through to WASM instead of hard-failing
    tier = 'WASM';
    model = MODEL_TIERS.WASM;
    if (!supportsWebGPU) {
      warnings.push({
        type: 'no_webgpu',
        message: 'WebGPU not available. Falling back to CPU/WASM mode with a smaller model.',
        severity: 'info',
      });
    }
  } else if (ram >= 8) {
    tier = 'HIGH';
    model = MODEL_TIERS.HIGH;
  } else {
    tier = 'LOW';
    model = MODEL_TIERS.LOW;
  }

  return {
    tier,
    model,
    ram,
    gpuInfo,
    supportsWebGPU,
    isFallbackAdapter,
    hasSharedArrayBuffer,
    warnings,
  };
}

/**
 * Returns all available model options for manual selection.
 */
export function getAllModels() {
  return Object.values(MODEL_TIERS);
}

// ── Session key & profile cache helpers ─────────────────────────────
const PROFILE_CACHE_KEY = 'sentry_hw_profile_v2';

/**
 * Generates a short random session key (stays only in RAM — never persisted).
 */
export function generateSessionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return (
    'SENTRY_LOCAL_' +
    Array.from(bytes)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join('')
  );
}

/**
 * Returns a cached hardware profile if it exists and was generated with the
 * same browser version (to trigger a re-scan on browser updates).
 */
export function getCachedProfile() {
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    // Invalidate if browser version has changed
    if (cached.userAgent !== navigator.userAgent) return null;
    return cached;
  } catch {
    return null;
  }
}

/**
 * Persists a hardware profile to sessionStorage (cleared on tab close).
 */
export function setCachedProfile(profile) {
  try {
    sessionStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ ...profile, userAgent: navigator.userAgent })
    );
  } catch {
    // sessionStorage may be unavailable in some contexts — silently ignore
  }
}