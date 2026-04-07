// ================================================================
// deviceProfile.js — Hardware-Aware Model Selection
// ADDED: generateSessionKey()   — SENTRY_LOCAL_XXXX (RAM-only, never persisted)
// ADDED: getCachedProfile()     — localStorage cache keyed to browser version
// ADDED: setCachedProfile()     — saves profile so re-scan only on browser update
// ADDED: clearCachedProfile()   — called when user clears app data
// ================================================================

export const MODEL_TIERS = {
  HIGH: {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 3B · High Quality',
    shortLabel: 'Sentry Turbo',
    tagline: 'AI Engine 3.0 · Best for complex reasoning',
    size: '2.1 GB',
    minRam: 8,
    icon: '⚡',
  },
  LOW: {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 1B · Efficient',
    shortLabel: 'Sentry Lite',
    tagline: 'Privacy Mode · Best for battery & older devices',
    size: '0.9 GB',
    minRam: 0,
    icon: '🍃',
  },
};

// ── Browser fingerprint (used as cache key so re-scan fires on Chrome updates) ──
function getBrowserFingerprint() {
  const ua = navigator.userAgent;
  const chrome = ua.match(/Chrome\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  const safari = ua.match(/Version\/(\d+).*Safari/);
  if (chrome) return `chrome-${chrome[1]}`;
  if (firefox) return `firefox-${firefox[1]}`;
  if (safari) return `safari-${safari[1]}`;
  return 'browser-unknown';
}

const CACHE_KEY_PREFIX = 'sentry_hw_profile_';

/**
 * Returns a cached hardware profile if the browser version matches.
 * Returns null on first visit or after a browser update — triggers a fresh scan.
 */
export function getCachedProfile() {
  try {
    const key = CACHE_KEY_PREFIX + getBrowserFingerprint();
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Expire after 7 days just in case (driver updates, etc.)
    if (Date.now() - (parsed.cachedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persists the hardware profile to localStorage, keyed by browser version.
 * Only the capability flags are stored — no personal data.
 */
export function setCachedProfile(profile) {
  try {
    // Clean up any stale entries from old browser versions
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(k);
      }
    }
    const key = CACHE_KEY_PREFIX + getBrowserFingerprint();
    const toStore = {
      tier: profile.tier,
      ram: profile.ram,
      supportsWebGPU: profile.supportsWebGPU,
      gpuInfo: profile.gpuInfo,
      mobileOverride: profile.mobileOverride || false,
      cachedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(toStore));
  } catch {
    // localStorage quota exceeded or unavailable — non-fatal
  }
}

/** Wipes the cached profile so the next page load re-runs the full scan. */
export function clearCachedProfile() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_KEY_PREFIX)) localStorage.removeItem(k);
    }
  } catch { }
}

/**
 * Generates a one-time session identifier that lives only in RAM.
 * It is never written to localStorage, IndexedDB, or sent over the network.
 * Displayed in the Diagnostic UI as a "Security Theater" trust signal.
 *
 * Format: SENTRY_LOCAL_XXXXXXXXXXXX
 */
export function generateSessionKey() {
  const raw = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  return `SENTRY_LOCAL_${raw.slice(0, 12)}`;
}

/**
 * Probes hardware capabilities and returns the best model config.
 * Unchanged from original — still used by useModelManager.
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
        const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
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

/** Returns all available model options for manual selection. */
export function getAllModels() {
  return Object.values(MODEL_TIERS);
}