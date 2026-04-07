// ================================================================
// deviceProfile.js — Hardware-Aware Model Selection
// ENHANCED: 5-tier model system covering all use cases
// - Speed-optimized for instant responses
// - Quality-focused for complex reasoning
// - Android-compatible without WebGPU
// - Balanced general-purpose options
// - Privacy-first local inference
// ================================================================

export const MODEL_TIERS = {
  // ── SPEED TIER: Fastest responses, great for quick queries ─────────
  SPEED: {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 · 0.5B',
    shortLabel: 'Lightning Fast',
    tagline: 'Instant responses · Perfect for quick questions',
    adjectives: ['fastest', 'instant', 'snappy'],
    size: '0.4 GB',
    icon: '⚡',
    minRam: 2,
    device: 'webgpu',
    strengths: ['Speed', 'Low memory', 'Quick answers'],
    weaknesses: ['Less context', 'Simpler reasoning'],
  },

  // ── BALANCED TIER: Best all-rounder for most tasks ─────────────────
  BALANCED: {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 1B',
    shortLabel: 'Well-Rounded',
    tagline: 'Smart & efficient · Great for everyday tasks',
    adjectives: ['balanced', 'efficient', 'practical'],
    size: '0.9 GB',
    icon: '🎯',
    minRam: 4,
    device: 'webgpu',
    strengths: ['Good reasoning', 'Battery friendly', 'Reliable'],
    weaknesses: ['Moderate complexity limit'],
  },

  // ── QUALITY TIER: Best reasoning for complex problems ──────────────
  QUALITY: {
    id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    label: 'Phi 3.5 Mini · 3.8B',
    shortLabel: 'High Quality',
    tagline: 'Superior reasoning · Best for complex tasks',
    adjectives: ['intelligent', 'thorough', 'precise'],
    size: '2.3 GB',
    icon: '🧠',
    minRam: 6,
    device: 'webgpu',
    strengths: ['Excellent reasoning', 'Great code understanding', 'Detailed answers'],
    weaknesses: ['Larger size', 'More battery usage'],
  },

  // ── POWER TIER: Maximum capabilities for demanding work ────────────
  POWER: {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 · 3B',
    shortLabel: 'Maximum Power',
    tagline: 'Peak performance · Professional-grade AI',
    adjectives: ['powerful', 'comprehensive', 'advanced'],
    size: '2.1 GB',
    icon: '🚀',
    minRam: 8,
    device: 'webgpu',
    strengths: ['Best performance', 'Complex reasoning', 'Large context'],
    weaknesses: ['Requires more RAM', 'Slower on older devices'],
  },

  // ── UNIVERSAL TIER: Works on any device, even without WebGPU ──────
  UNIVERSAL: {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    label: 'Qwen 2.5 · 0.5B · CPU',
    shortLabel: 'Universal Compatible',
    tagline: 'Runs anywhere · No GPU needed',
    adjectives: ['compatible', 'reliable', 'accessible'],
    size: '0.4 GB',
    icon: '🌐',
    minRam: 2,
    device: 'wasm',
    isFallback: true,
    strengths: ['Works on all devices', 'No WebGPU required', 'Android-friendly'],
    weaknesses: ['CPU-only (slower)', 'Basic capabilities'],
  },
};

/**
 * Confidence score calculation helper
 * Determines if response is from RAG context (high confidence) or generated (low confidence)
 */
export function calculateConfidenceScore(hasRagContext, modelTier, messageLength) {
  // High confidence: RAG context available
  if (hasRagContext) {
    return {
      level: 'high',
      score: 90 + Math.min(10, Math.floor(messageLength / 100)), // 90-100%
      source: 'context',
      display: '✅ High confidence',
      color: 'emerald',
      explanation: 'Answer based on your documents',
    };
  }

  // Medium-high confidence: Quality/Power models with good training
  if (modelTier === 'QUALITY' || modelTier === 'POWER') {
    return {
      level: 'medium-high',
      score: 70 + Math.min(15, Math.floor(messageLength / 50)),
      source: 'generated',
      display: '⚠️ Medium confidence',
      color: 'amber',
      explanation: 'Generated from AI training (may need verification)',
    };
  }

  // Low confidence: Smaller models or no context
  return {
    level: 'low',
    score: 50 + Math.min(20, Math.floor(messageLength / 30)),
    source: 'generated',
    display: '⚠️ Low confidence',
    color: 'amber',
    explanation: 'Generated response (please verify facts)',
  };
}

/**
 * Probes hardware capabilities and returns the best model config.
 * @returns {Promise<{tier, model, ram, gpuInfo, supportsWebGPU, isFallbackAdapter, hasSharedArrayBuffer, warnings, recommendations}>}
 */
export async function detectHardwareProfile() {
  const warnings = [];
  const recommendations = [];

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

        // Detect software/fallback adapters (common on budget Android)
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
            message: 'WebGPU is running in software emulation mode. Performance will be slower.',
            severity: 'warning',
          });
        }
      }
    } catch (e) {
      supportsWebGPU = false;
    }
  }

  // ── Tier selection with recommendations ─────────────────────────────
  let tier, model;
  const availableModels = [];

  if (!supportsWebGPU || isFallbackAdapter || !hasSharedArrayBuffer) {
    // No WebGPU → Universal tier only
    tier = 'UNIVERSAL';
    model = MODEL_TIERS.UNIVERSAL;
    availableModels.push(MODEL_TIERS.UNIVERSAL);

    recommendations.push({
      type: 'device_limitation',
      message: 'Your device doesn\'t support WebGPU. Using CPU-compatible model.',
      suggestion: 'For better performance, try Chrome or Edge on a device with GPU support.',
    });
  } else if (ram >= 8) {
    // High-end device → All models available, recommend Power/Quality
    tier = 'POWER';
    model = MODEL_TIERS.POWER;
    availableModels.push(
      MODEL_TIERS.POWER,
      MODEL_TIERS.QUALITY,
      MODEL_TIERS.BALANCED,
      MODEL_TIERS.SPEED
    );

    recommendations.push({
      type: 'optimal',
      message: 'Your device supports all models!',
      suggestion: 'Try "High Quality" (Phi 3.5) for best reasoning, or "Maximum Power" for peak performance.',
    });
  } else if (ram >= 6) {
    // Mid-range → Quality is max, recommend Quality/Balanced
    tier = 'QUALITY';
    model = MODEL_TIERS.QUALITY;
    availableModels.push(
      MODEL_TIERS.QUALITY,
      MODEL_TIERS.BALANCED,
      MODEL_TIERS.SPEED
    );

    recommendations.push({
      type: 'good',
      message: 'Your device handles mid-to-large models well.',
      suggestion: 'Try "High Quality" (Phi 3.5) for best results, or "Well-Rounded" for battery efficiency.',
    });
  } else if (ram >= 4) {
    // Entry-level WebGPU → Balanced max, recommend Balanced/Speed
    tier = 'BALANCED';
    model = MODEL_TIERS.BALANCED;
    availableModels.push(
      MODEL_TIERS.BALANCED,
      MODEL_TIERS.SPEED
    );

    recommendations.push({
      type: 'balanced',
      message: 'Your device works best with smaller models.',
      suggestion: 'Use "Well-Rounded" for everyday tasks, or "Lightning Fast" for quick answers.',
    });
  } else {
    // Very low RAM → Speed only
    tier = 'SPEED';
    model = MODEL_TIERS.SPEED;
    availableModels.push(MODEL_TIERS.SPEED);

    recommendations.push({
      type: 'limited',
      message: 'Your device has limited memory.',
      suggestion: 'Using "Lightning Fast" model for best performance.',
    });
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
    recommendations,
    availableModels,
  };
}

/**
 * Returns all available model options based on device capabilities.
 */
export function getAvailableModels(profile) {
  if (!profile) return Object.values(MODEL_TIERS);
  return profile.availableModels || [profile.model];
}

/**
 * Returns model tier name from model ID
 */
export function getModelTierFromId(modelId) {
  for (const [tierName, tierData] of Object.entries(MODEL_TIERS)) {
    if (tierData.id === modelId) {
      return tierName;
    }
  }
  return 'BALANCED'; // Default fallback
}

// ── Session key & profile cache helpers ─────────────────────────────
const PROFILE_CACHE_KEY = 'sentry_hw_profile_v3'; // Bumped version

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