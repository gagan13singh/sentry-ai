// ================================================================
// deviceProfile.js — ANDROID-OPTIMIZED Hardware Detection
// FIXES:
// - Detects MediaTek/Mali/Adreno GPUs correctly
// - Better fallback adapter detection
// - Android Chrome memory constraints
// - Conservative RAM estimation for older devices
// ================================================================

export const MODEL_TIERS = {
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

export function calculateConfidenceScore(hasRagContext, modelTier, messageLength) {
  if (hasRagContext) {
    return {
      level: 'high',
      score: 90 + Math.min(10, Math.floor(messageLength / 100)),
      source: 'context',
      display: '✅ High confidence',
      color: 'emerald',
      explanation: 'Answer based on your documents',
    };
  }

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

  return {
    level: 'low',
    score: 50 + Math.min(20, Math.floor(messageLength / 30)),
    source: 'generated',
    display: '⚠️ Low confidence',
    color: 'amber',
    explanation: 'Generated response (please verify facts)',
  };
}

// OPTIMIZATION: Enhanced Android GPU detection
async function detectAndroidGPU() {
  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = /android/.test(ua);
  if (!isAndroid) return null;

  // Common Android GPU patterns
  const gpuPatterns = {
    adreno: /adreno (\d+)/i,
    mali: /mali-([a-z0-9]+)/i,
    mediatek: /mt(\d+)/i,
    powervr: /powervr/i,
  };

  for (const [vendor, pattern] of Object.entries(gpuPatterns)) {
    const match = ua.match(pattern);
    if (match) {
      return {
        vendor,
        model: match[1] || 'unknown',
        isLowEnd: vendor === 'mali' && parseInt(match[1]) < 600,
      };
    }
  }
  return null;
}

export async function detectHardwareProfile() {
  const warnings = [];
  const recommendations = [];

  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  if (!hasSharedArrayBuffer) {
    warnings.push({
      type: 'missing_sab',
      message: 'SharedArrayBuffer unavailable — COOP/COEP headers missing. WebLLM will fail silently.',
      severity: 'critical',
    });
  }

  // OPTIMIZATION: Better RAM detection for Android
  let ram = navigator.deviceMemory ?? 4;
  const androidGPU = await detectAndroidGPU();

  // Conservative estimate for older Android devices
  if (androidGPU && androidGPU.isLowEnd && ram < 3) {
    ram = Math.max(2, ram); // Force minimum 2GB for compatibility
    warnings.push({
      type: 'low_memory_android',
      message: 'Low-memory Android device detected. Using lightweight model.',
      severity: 'warning',
    });
  }

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

        // OPTIMIZATION: Enhanced fallback detection for Android
        isFallbackAdapter = !!(
          adapter.isFallbackAdapter ||
          (info.vendor || '').toLowerCase().includes('google') ||
          (info.vendor || '').toLowerCase().includes('swiftshader') ||
          (info.architecture || '').toLowerCase().includes('swiftshader') ||
          (info.description || '').toLowerCase().includes('llvmpipe') ||
          (info.description || '').toLowerCase().includes('softpipe') ||
          (info.description || '').toLowerCase().includes('swiftshader') ||
          // Android-specific software renderer patterns
          (info.description || '').toLowerCase().includes('angle') ||
          (info.vendor || '').toLowerCase().includes('vivante')
        );

        // OPTIMIZATION: Detect problematic Android GPU drivers
        if (androidGPU && !isFallbackAdapter) {
          const limits = await adapter.requestDevice().then(device => device.limits);
          
          // Check if GPU memory is too constrained
          if (limits && limits.maxBufferSize < 256 * 1024 * 1024) {
            isFallbackAdapter = true;
            warnings.push({
              type: 'constrained_gpu',
              message: 'GPU memory constraints detected. Using CPU fallback for stability.',
              severity: 'warning',
            });
          }
        }

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
      console.warn('WebGPU detection failed:', e);
    }
  }

  let tier, model;
  const availableModels = [];

  // OPTIMIZATION: Android-aware model selection
  if (!supportsWebGPU || isFallbackAdapter || !hasSharedArrayBuffer || (androidGPU && androidGPU.isLowEnd)) {
    tier = 'UNIVERSAL';
    model = MODEL_TIERS.UNIVERSAL;
    availableModels.push(MODEL_TIERS.UNIVERSAL);

    recommendations.push({
      type: 'device_limitation',
      message: 'Your device doesn\'t support WebGPU or has constrained resources. Using CPU-compatible model.',
      suggestion: androidGPU 
        ? 'For better performance on Android, try Chrome Canary with WebGPU flags enabled.'
        : 'For better performance, try Chrome or Edge on a device with GPU support.',
    });
  } else if (ram >= 8) {
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
    androidGPU, // Include Android GPU info for debugging
  };
}

export function getAvailableModels(profile) {
  if (!profile) return Object.values(MODEL_TIERS);
  return profile.availableModels || [profile.model];
}

export function getModelTierFromId(modelId) {
  for (const [tierName, tierData] of Object.entries(MODEL_TIERS)) {
    if (tierData.id === modelId) {
      return tierName;
    }
  }
  return 'BALANCED';
}

const PROFILE_CACHE_KEY = 'sentry_hw_profile_v4'; // Bumped for Android fixes

export function generateSessionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return (
    'SENTRY_LOCAL_' +
    Array.from(bytes)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join('')
  );
}

export function getCachedProfile() {
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.userAgent !== navigator.userAgent) return null;
    return cached;
  } catch {
    return null;
  }
}

export function setCachedProfile(profile) {
  try {
    sessionStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ ...profile, userAgent: navigator.userAgent })
    );
  } catch {
    // Ignore
  }
}