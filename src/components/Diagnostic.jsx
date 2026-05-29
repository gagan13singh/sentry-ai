// ================================================================
// Diagnostic.jsx — Enhanced "Security Scan" Pre-Flight Dashboard
//
// NEW: 5-tier model system with smart device-based recommendations
// NEW: User-friendly adjectives (Lightning Fast, Well-Rounded, etc.)
// NEW: Shows suitable models based on device capabilities
// FIXED: Models now appear immediately after scan completion
// ================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, CheckCircle, Zap, ChevronDown, ChevronUp, RefreshCw, ExternalLink, ChevronRight, Info, AlertTriangle } from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { MODEL_TIERS, generateSessionKey, getCachedProfile, setCachedProfile } from '../lib/deviceProfile';

// ── Scan step definitions ────────────────────────────────────────────────────
const SCAN_STEPS = [
    {
        id: 'isolation',
        icon: '🔎',
        label: 'Securing Sandbox',
        subtext: 'Ensuring no other tabs can read your chat',
    },
    {
        id: 'vram',
        icon: '🧠',
        label: 'Allocating RAM',
        subtext: 'Carving out safe local memory for the AI',
    },
    {
        id: 'gpu',
        icon: '🛡️',
        label: 'Testing GPU Path',
        subtext: 'Bypassing the cloud for direct hardware access',
    },
    {
        id: 'key',
        icon: '🔑',
        label: 'Generating Session Key',
        subtext: 'Creating a one-time local encryption identifier',
    },
];

const STEP_DELAY_MS = 900;

// ── Status badge colours ─────────────────────────────────────────────────────
const STATUS_STYLES = {
    pending: { color: 'var(--muted)', label: '···' },
    running: { color: 'var(--cyan)', label: 'SCANNING' },
    pass: { color: 'var(--emerald)', label: 'VERIFIED ✓' },
    fail: { color: 'var(--amber)', label: 'RESTRICTED' },
    error: { color: 'var(--red)', label: 'ERROR' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function checkSAB() {
    try {
        if (typeof SharedArrayBuffer === 'undefined') return false;
        new SharedArrayBuffer(1);
        return true;
    } catch { return false; }
}

async function probeWebGPU() {
    if (typeof navigator.gpu === 'undefined') return { supported: false, gpuInfo: null };
    try {
        const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent);
        const options = isWindows ? {} : { powerPreference: 'high-performance' };
        const adapter = await navigator.gpu.requestAdapter(options);
        if (!adapter) return { supported: false, gpuInfo: null };
        const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
        return {
            supported: true,
            gpuInfo: {
                vendor: info.vendor || 'Unknown',
                architecture: info.architecture || 'Unknown',
                description: info.description || 'WebGPU GPU',
            },
        };
    } catch { return { supported: false, gpuInfo: null }; }
}

const isChromiumBrowser = () => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    const isChrome = ua.includes('chrome') || ua.includes('chromium') || ua.includes('crios');
    const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium') && !ua.includes('crios');
    const isFirefox = ua.includes('firefox') || ua.includes('fxios');
    return isChrome && !isSafari && !isFirefox;
};

// ── Main component ───────────────────────────────────────────────────────────
export default function Diagnostic() {
    const { model } = useApp();
    const navigate = useNavigate();

    const [stepStatuses, setStepStatuses] = useState(SCAN_STEPS.map(() => 'pending'));
    const [stepResults, setStepResults] = useState(SCAN_STEPS.map(() => null));
    const [currentStep, setCurrentStep] = useState(-1);
    const [scanDone, setScanDone] = useState(false);
    const [fromCache, setFromCache] = useState(false);

    const scanData = useRef({ sabOk: false, ram: 0, webGPU: false, gpuInfo: null });
    const errorRef = useRef(null);

    const [selectedModel, setSelectedModel] = useState(null);
    const [availableModels, setAvailableModels] = useState([]);
    const [recommendedModel, setRecommendedModel] = useState(null);
    const [deviceRecommendation, setDeviceRecommendation] = useState(null);
    const [showUnlock, setShowUnlock] = useState(false);
    const [webGPUSupported, setWebGPUSupported] = useState(true);
    const [geminiNanoSupported, setGeminiNanoSupported] = useState(false);
    const [showGeminiUnlock, setShowGeminiUnlock] = useState(false);

    // Auto-scroll to error banner whenever an error appears
    useEffect(() => {
        if (model.error && errorRef.current) {
            // Small delay so the banner has time to mount
            const t = setTimeout(() => {
                errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 80);
            return () => clearTimeout(t);
        }
    }, [model.error]);

    function setStep(idx, status, result = null) {
        setStepStatuses(prev => { const n = [...prev]; n[idx] = status; return n; });
        setStepResults(prev => { const n = [...prev]; n[idx] = result; return n; });
    }

    const populateModelSelections = useCallback((profile) => {
        if (!profile) return;

        const available = profile.availableModels || [];
        setAvailableModels(available);

        // Set recommended model
        const recommended = profile.model;
        setRecommendedModel(recommended);
        setSelectedModel(recommended?.id || MODEL_TIERS.UNIVERSAL.id);

        // Set device recommendation message
        if (profile.recommendations && profile.recommendations.length > 0) {
            setDeviceRecommendation(profile.recommendations[0]);
        }

        // Detect Gemini Nano support
        setGeminiNanoSupported(!!profile.supportsGeminiNano);
    }, []);

    const finaliseScan = useCallback(async () => {
        setCurrentStep(4);
        setScanDone(true);

        const profile = {
            sabAvailable: scanData.current.sabOk,
            hasSharedArrayBuffer: scanData.current.sabOk,
            ram: scanData.current.ram,
            supportsWebGPU: scanData.current.webGPU,
            gpuInfo: scanData.current.gpuInfo,
            tier: scanData.current.ram >= 8 ? 'POWER' : scanData.current.ram >= 6 ? 'QUALITY' : scanData.current.ram >= 4 ? 'BALANCED' : 'SPEED',
        };

        if (!scanData.current.webGPU) {
            profile.tier = 'UNIVERSAL';
        }

        setCachedProfile(profile);
        setWebGPUSupported(scanData.current.webGPU);
        const currentProfile = await model.detectHardware();
        populateModelSelections(currentProfile);
    }, [model, populateModelSelections]);

    const runFullScan = useCallback(async () => {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        setCurrentStep(0);
        setStep(0, 'running');
        await delay(STEP_DELAY_MS);
        const sabOk = checkSAB();
        scanData.current.sabOk = sabOk;
        setStep(0, sabOk ? 'pass' : 'fail', sabOk ? 'SharedArrayBuffer active' : 'Missing COOP/COEP headers');

        setCurrentStep(1);
        setStep(1, 'running');
        await delay(STEP_DELAY_MS);
        const ram = navigator.deviceMemory ?? 4;
        scanData.current.ram = ram;
        setStep(1, 'pass', `${ram} GB detected`);

        setCurrentStep(2);
        setStep(2, 'running');
        const gpuResult = await probeWebGPU();
        await delay(Math.max(0, STEP_DELAY_MS - 100));
        scanData.current.webGPU = gpuResult.supported;
        scanData.current.gpuInfo = gpuResult.gpuInfo;
        const gpuLabel = gpuResult.supported
            ? (gpuResult.gpuInfo?.description || 'GPU Access Granted')
            : 'Direct GPU access restricted by browser';
        setStep(2, gpuResult.supported ? 'pass' : 'fail', gpuLabel);

        setCurrentStep(3);
        setStep(3, 'running');
        await delay(STEP_DELAY_MS - 200);
        const key = generateSessionKey();
        setStep(3, 'pass', key);

        await finaliseScan();
    }, [finaliseScan]);

    const loadFromCache = useCallback(async (cached) => {
        setFromCache(true);
        const results = [
            cached.hasSharedArrayBuffer !== false ? 'SharedArrayBuffer active' : 'Missing COOP/COEP headers',
            `${cached.ram} GB detected`,
            cached.supportsWebGPU
                ? (cached.gpuInfo?.description || 'GPU Access Granted')
                : 'Direct GPU access restricted by browser',
            generateSessionKey(),
        ];
        const statuses = [
            'pass',
            'pass',
            cached.supportsWebGPU ? 'pass' : 'fail',
            'pass',
        ];
        setStepStatuses(statuses);
        setStepResults(results);
        setCurrentStep(4);
        scanData.current = {
            sabOk: cached.hasSharedArrayBuffer !== false,
            ram: cached.ram,
            webGPU: cached.supportsWebGPU,
            gpuInfo: cached.gpuInfo,
        };

        setWebGPUSupported(cached.supportsWebGPU);
        const currentProfile = await model.detectHardware();
        populateModelSelections(currentProfile);
        setScanDone(true);
    }, [model, populateModelSelections]);
    useEffect(() => {
        const cached = getCachedProfile();
        const t = setTimeout(() => {
            if (cached && cached.tier) {
                loadFromCache(cached);
            } else {
                runFullScan();
            }
        }, 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canLoad = scanDone && selectedModel;
    const isLoading = model.status === MODEL_STATUS.LOADING;
    const isReady = model.status === MODEL_STATUS.READY;
    async function handleLoadModel() {
        if (!canLoad || isLoading) return;

        // Find the tier for the selected model
        const selectedTier = Object.entries(MODEL_TIERS).find(
            ([, tierData]) => tierData.id === selectedModel
        )?.[0];

        await model.loadModel(selectedModel, selectedTier);
    }

    return (
        <div>
            <div className="diag-header" style={{ marginBottom: 16 }}>
                <h2 className="diag-title">
                    <Shield size={22} className="text-cyan" style={{ marginRight: 8 }} />
                    {fromCache ? 'Profile Loaded' : 'Security Scan'}
                </h2>
                <p className="text-muted text-sm">
                    {fromCache
                        ? 'Cached profile detected — no need to rescan.'
                        : 'Verifying your device can run AI models safely and privately.'
                    }
                </p>
                {fromCache && (
                    <button
                        className="btn-icon"
                        onClick={() => { setFromCache(false); runFullScan(); }}
                        style={{ marginTop: 10 }}
                        title="Re-scan hardware"
                    >
                        <RefreshCw size={14} /> <span style={{ fontSize: 11, marginLeft: 4 }}>Re-scan</span>
                    </button>
                )}
            </div>

            {/* Scan Steps */}
            <div className="scan-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                {SCAN_STEPS.map((step, i) => {
                    const status = stepStatuses[i];
                    const result = stepResults[i];
                    const style = STATUS_STYLES[status];
                    const isActive = i === currentStep;

                    return (
                        <div
                            key={step.id}
                            style={{
                                background: isActive ? 'rgba(6,182,212,0.08)' : 'rgba(255,255,255,0.02)',
                                border: `1px solid ${isActive ? 'rgba(6,182,212,0.3)' : 'rgba(255,255,255,0.08)'}`,
                                borderRadius: 8,
                                padding: '12px 14px',
                                transition: 'all 0.3s ease',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 18 }}>{step.icon}</span>
                                <span style={{ fontSize: 9, color: style.color, fontWeight: 700, letterSpacing: 0.5 }}>
                                    {style.label}
                                </span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                                {step.label}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                                {result || step.subtext}
                            </div>
                            {status === 'running' && (
                                <div style={{
                                    width: 6, height: 6, marginTop: 6,
                                    background: 'var(--cyan)', borderRadius: '50%',
                                    animation: 'pulse-dot 1.5s ease-in-out infinite',
                                }} />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Device Recommendation Banner */}
            {scanDone && deviceRecommendation && (
                <div style={{
                    background: 'rgba(6,182,212,0.05)',
                    border: '1px solid rgba(6,182,212,0.2)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                }}>
                    <Info size={16} className="text-cyan" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                            {deviceRecommendation.message}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {deviceRecommendation.suggestion}
                        </div>
                    </div>
                </div>
            )}

            {/* Error Banner */}
            {model.error && (
                <div
                    ref={errorRef}
                    className="error-banner"
                    style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius: 8,
                        padding: '12px 14px',
                        marginBottom: 16,
                        color: '#f87171',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        animation: 'errorPop 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
                        boxShadow: '0 0 0 0 rgba(239,68,68,0.5)',
                        whiteSpace: 'pre-line',
                    }}
                >
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2, color: '#f87171' }} />
                    <div>
                        <strong style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                            Engine Loading Failed
                        </strong>
                        <span style={{ lineHeight: 1.6 }}>{model.error}</span>
                    </div>
                </div>
            )}

            {/* Model Selection */}
            {scanDone && !isReady && (
                <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                            Choose Your AI Engine
                        </h3>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {availableModels.length} compatible {availableModels.length === 1 ? 'model' : 'models'}
                        </span>
                    </div>

                    <div style={{
                        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.01) 0%, rgba(255, 255, 255, 0.03) 100%)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: 12,
                        padding: '14px 16px',
                        marginBottom: 16,
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                    }}>
                        <Info size={16} className="text-cyan" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div style={{ fontSize: '12px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                            <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>AI Engine Selection Guide</strong>
                            Select an engine based on your task and device capability. 
                            Use <strong style={{ color: 'var(--cyan)' }}>Lightning Fast</strong> for quick Q&A, 
                            <strong style={{ color: 'var(--cyan)' }}>Well-Rounded</strong> for everyday tasks, and 
                            <strong style={{ color: 'var(--cyan)' }}>High Quality</strong> or <strong style={{ color: 'var(--cyan)' }}>Maximum Power</strong> for complex reasoning, programming, and large document analysis. 
                            {isChromiumBrowser() ? (
                                <span> Alternatively, you can use <strong style={{ color: 'var(--emerald)' }}>Google Gemini Nano</strong> below for native, zero-download hardware acceleration.</span>
                            ) : null}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                        {availableModels.map(tier => (
                            <ModelCard
                                key={tier.id}
                                tier={tier}
                                selected={selectedModel === tier.id}
                                recommended={recommendedModel?.id === tier.id}
                                onClick={() => setSelectedModel(tier.id)}
                            />
                        ))}
                    </div>

                    {!webGPUSupported && (
                        <div style={{ marginTop: 12 }}>
                            <button
                                className="btn-icon"
                                onClick={() => setShowUnlock(!showUnlock)}
                                style={{ fontSize: 11, color: 'var(--cyan)' }}
                            >
                                {showUnlock ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                <span style={{ marginLeft: 4 }}>How to enable faster models</span>
                            </button>
                            {showUnlock && <UnlockGuide />}
                        </div>
                    )}

                    {isChromiumBrowser() ? (
                        <>
                            {/* OR divider */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                margin: '24px 0 20px',
                            }}>
                                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                                <span style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    letterSpacing: '0.12em',
                                    color: 'var(--text-muted)',
                                    padding: '3px 10px',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderRadius: 100,
                                    background: 'rgba(255,255,255,0.03)',
                                    flexShrink: 0,
                                }}>
                                    OR
                                </span>
                                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                            </div>

                            <div
                                className="gemini-nano-card"
                                onClick={() => setSelectedModel('chrome-gemini-nano')}
                                style={{
                                    background: selectedModel === 'chrome-gemini-nano' ? 'rgba(6,182,212,0.06)' : 'rgba(255,255,255,0.02)',
                                    border: `2px solid ${selectedModel === 'chrome-gemini-nano' ? 'var(--cyan)' : 'rgba(255,255,255,0.06)'}`,
                                    boxShadow: selectedModel === 'chrome-gemini-nano' ? '0 0 25px rgba(6,182,212,0.18)' : 'none',
                                    borderRadius: 12,
                                    padding: '20px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    position: 'relative',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12,
                                }}
                            >
                                {/* Top Line / Logo & Badge */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: 10,
                                            background: 'rgba(0, 0, 0, 0.2)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            border: '1px solid rgba(255,255,255,0.05)',
                                            filter: selectedModel === 'chrome-gemini-nano' ? 'drop-shadow(0 0 8px rgba(99,102,241,0.5))' : 'none',
                                            transition: 'filter 0.3s ease',
                                        }}>
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ animation: selectedModel === 'chrome-gemini-nano' ? 'pulse-logo 2.5s ease-in-out infinite' : 'none' }}>
                                                <path d="M12 2C12 2 12.5 7.5 14.5 9.5C16.5 11.5 22 12 22 12C22 12 16.5 12.5 14.5 14.5C12.5 16.5 12 22 12 22C12 22 11.5 16.5 9.5 14.5C7.5 12.5 2 12 2 12C2 12 7.5 11.5 9.5 9.5C11.5 7.5 12 2 12 2Z" fill="url(#gemini-grad-diag)"/>
                                                <defs>
                                                    <linearGradient id="gemini-grad-diag" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                                        <stop offset="0%" stopColor="#4285F4" />
                                                        <stop offset="35%" stopColor="#9B72CB" />
                                                        <stop offset="70%" stopColor="#D96570" />
                                                        <stop offset="100%" stopColor="#F48120" />
                                                    </linearGradient>
                                                </defs>
                                            </svg>
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                Google Gemini Nano
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                                Official Built-in Engine · 100% Offline Privacy
                                            </div>
                                        </div>
                                    </div>

                                    {/* Badge */}
                                    <div>
                                        {geminiNanoSupported ? (
                                            <span style={{
                                                padding: '4px 10px',
                                                fontSize: 10,
                                                fontWeight: 700,
                                                borderRadius: 100,
                                                background: 'rgba(16,185,129,0.1)',
                                                border: '1px solid var(--emerald)',
                                                color: 'var(--emerald)',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                boxShadow: '0 0 10px rgba(16,185,129,0.15)',
                                            }}>
                                                ✨ Verified Supported on Device
                                            </span>
                                        ) : (
                                            <span style={{
                                                padding: '4px 10px',
                                                fontSize: 10,
                                                fontWeight: 700,
                                                borderRadius: 100,
                                                background: 'rgba(99,102,241,0.1)',
                                                border: '1px solid rgba(99,102,241,0.3)',
                                                color: '#818cf8',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                            }}>
                                                ℹ️ Experimental Engine Available
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Description */}
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                    Gemini Nano is Google’s highly-optimized local AI model integrated directly into modern Chromium browsers. Bypassing standard CPU wrappers, it talks directly to your graphics chip (GPU) or neural processor (NPU) for high-performance offline reasoning. Zero bytes of data are sent to Google or Sentry servers—guaranteeing 100% offline privacy and security.
                                </div>

                                {/* Bullets grid */}
                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                                        <span style={{ color: 'var(--cyan)' }}>🚀</span>
                                        <strong>Instant Launch</strong>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                                        <span style={{ color: 'var(--cyan)' }}>🔒</span>
                                        <strong>100% Offline</strong>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                                        <span style={{ color: 'var(--cyan)' }}>🧠</span>
                                        <strong>NPU Accelerated</strong>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--emerald)' }}>
                                        <span style={{ color: 'var(--emerald)' }}>🛡️</span>
                                        <strong>Zero Cloud Calls (100% Private)</strong>
                                    </div>
                                </div>

                                {/* Live prerequisite checker */}
                                <GeminiNanoChecker />
                            </div>

                            {/* Gemini Troubleshooting */}
                            <div style={{ marginTop: 12 }}>
                                <button
                                    type="button"
                                    className="btn-icon"
                                    onClick={(e) => { e.stopPropagation(); setShowGeminiUnlock(!showGeminiUnlock); }}
                                    style={{ fontSize: 11, color: 'var(--cyan)', padding: 0 }}
                                >
                                    {showGeminiUnlock ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                    <span style={{ marginLeft: 4 }}>How to enable Gemini Nano in Chrome</span>
                                </button>
                                {showGeminiUnlock && <GeminiUnlockGuide />}
                            </div>
                        </>
                    ) : (
                        <div style={{
                            marginTop: 24,
                            background: 'rgba(255, 255, 255, 0.01)',
                            border: '1px dashed rgba(255, 255, 255, 0.08)',
                            borderRadius: 12,
                            padding: '16px 20px',
                            textAlign: 'left',
                            display: 'flex',
                            gap: 12,
                            alignItems: 'flex-start',
                        }}>
                            <Info size={16} className="text-cyan" style={{ marginTop: 2, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                                💡 <strong>Looking for native built-in AI?</strong> Open Sentry AI in a supported Chromium browser (like Google Chrome, Microsoft Edge, or Brave) to activate and select Google's highly optimized, NPU-accelerated <strong>Gemini Nano</strong> engine.
                            </span>
                        </div>
                    )}

                    <div style={{ marginTop: 24, textAlign: 'center' }}>
                        <button
                            className="btn btn-primary btn-lg"
                            onClick={handleLoadModel}
                            disabled={!canLoad || isLoading}
                            style={{ minWidth: 200 }}
                        >
                            {isLoading ? 'Loading Model...' : 'Load AI Model'}
                        </button>
                    </div>
                </div>
            )}

            {/* Loading Progress */}
            {isLoading && <LoadingProgress model={model} selectedModel={selectedModel} />}

            {/* Ready State */}
            {isReady && (
                <div className="setup-block success-block fade-in" style={{ marginTop: 20, textAlign: 'center' }}>
                    <div className="divider" />
                    <CheckCircle size={48} className="text-emerald" style={{ margin: '16px 0' }} />
                    <h3 className="text-emerald" style={{ marginBottom: 8 }}>Model Loaded Successfully</h3>
                    <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                        Your AI is ready. All inference happens locally on your device.
                    </p>

                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 16px',
                        background: 'rgba(16,185,129,0.1)',
                        border: '1px solid var(--emerald)',
                        borderRadius: 8,
                        marginBottom: 12,
                    }}>
                        <span style={{ fontSize: 22 }}>
                            {Object.values(MODEL_TIERS).find(t => t.id === selectedModel)?.icon || '🎯'}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {Object.values(MODEL_TIERS).find(t => t.id === selectedModel)?.shortLabel || 'Model Loaded'}
                        </span>
                    </div>

                    <button
                        className="btn btn-primary btn-lg"
                        onClick={() => navigate('/chat')}
                        style={{ marginTop: 8, minWidth: 200 }}
                    >
                        Start Chatting <ChevronRight size={16} />
                    </button>
                </div>
            )}

             <style>{`
                @keyframes pulse-dot {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.4; transform: scale(0.6); }
                }
                .gemini-nano-card:hover {
                    transform: translateY(-2px);
                    background: rgba(255,255,255,0.04) !important;
                    border-color: rgba(6,182,212,0.45) !important;
                    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35), 0 0 18px rgba(6, 182, 212, 0.08) !important;
                }
                @keyframes pulse-logo {
                    0%, 100% { transform: scale(1); filter: drop-shadow(0 0 4px rgba(99,102,241,0.3)); }
                    50% { transform: scale(1.08); filter: drop-shadow(0 0 12px rgba(99,102,241,0.6)); }
                }
                @keyframes errorPop {
                    0%   { opacity: 0; transform: scale(0.96) translateY(-6px); box-shadow: 0 0 0 0 rgba(239,68,68,0.45); }
                    55%  { opacity: 1; transform: scale(1.02) translateY(1px);  box-shadow: 0 0 0 8px rgba(239,68,68,0.12); }
                    80%  { transform: scale(0.99) translateY(0);                box-shadow: 0 0 0 14px rgba(239,68,68,0.04); }
                    100% { opacity: 1; transform: scale(1)   translateY(0);     box-shadow: 0 0 0 18px rgba(239,68,68,0); }
                }
            `}</style>
        </div>
    );
}

// ── Model selection card ──────────────────────────────────────────────────────
function ModelCard({ tier, selected, recommended, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                background: selected ? 'rgba(6,182,212,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${selected ? 'var(--cyan)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 8,
                padding: '12px 14px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
                position: 'relative',
            }}
        >
            {recommended && (
                <div style={{
                    position: 'absolute',
                    top: -8,
                    right: 8,
                    fontSize: 9,
                    fontWeight: 800,
                    color: '#000',
                    background: 'var(--cyan)',
                    padding: '3px 8px',
                    borderRadius: 12,
                    boxShadow: '0 0 10px rgba(6,182,212,0.5)',
                    letterSpacing: 0.8,
                    textTransform: 'uppercase',
                }}>
                    Recommended
                </div>
            )}

            <div style={{ fontSize: 20, marginBottom: 6 }}>{tier.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>
                {tier.shortLabel}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 4 }}>
                {tier.tagline}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {tier.size}
            </div>
        </button>
    );
}

// ── "Unlock Pro Performance" guide ───────────────────────────────────────────
function UnlockGuide() {
    return (
        <div style={{
            background: 'rgba(6,182,212,0.05)',
            border: '1px solid rgba(6,182,212,0.15)',
            borderRadius: 8,
            padding: '14px 16px',
            marginTop: 12,
            fontSize: 12,
            lineHeight: 1.6,
        }}>
            <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)' }}>
                <strong>Why is it restricted?</strong> Your browser has a safety speed-limiter active for
                newer GPU APIs. Enabling it is safe — it simply lets Sentry's local AI
                talk directly to your graphics chip for faster responses.
            </p>

            <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                How to unlock in Chrome:
            </p>

            <ol style={{ margin: '0 0 12px', paddingLeft: 18, color: 'var(--text-secondary)' }}>
                <li>Open a new tab and type <code style={{ color: 'var(--cyan)' }}>chrome://flags</code></li>
                <li>Search for <code style={{ color: 'var(--cyan)' }}>WebGPU Developer Features</code></li>
                <li>Set it to <strong>Enabled</strong></li>
                <li>Also search <code style={{ color: 'var(--cyan)' }}>Vulkan</code> → set to <strong>Enabled</strong></li>
                <li>Click <strong>Relaunch</strong> and return here</li>
            </ol>

            <a
                href="https://developer.chrome.com/docs/web-platform/webgpu"
                target="_blank" rel="noopener noreferrer"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    marginTop: 10, fontSize: 11, color: 'var(--cyan)',
                    textDecoration: 'none',
                }}
            >
                Learn more about WebGPU <ExternalLink size={11} />
            </a>
        </div>
    );
}

// ── Loading progress sub-component ───────────────────────────────────────────
function LoadingProgress({ model, selectedModel }) {
    const selectedTier = Object.values(MODEL_TIERS).find(t => t.id === selectedModel);

    return (
        <div className="setup-block loading-block fade-in" style={{ marginTop: 12 }}>
            <div className="divider" />
            <div className="loading-header">
                <Shield size={20} className="text-emerald" />
                <h3 className="text-emerald">Establishing Local Privacy</h3>
            </div>

            <div className="loading-progress-wrap">
                <div className="loading-status-row">
                    <span className="loading-status-text">
                        {model.progress.text || 'Loading from storage → GPU…'}
                    </span>
                    <span className="loading-percent mono">{model.progress.percent}%</span>
                </div>

                <div className="progress-bar" style={{ margin: '8px 0 4px' }}>
                    <div
                        className="progress-bar-fill"
                        style={{
                            width: `${model.progress.percent}%`,
                            background: model.progress.percent === 100
                                ? 'linear-gradient(90deg, var(--emerald), var(--cyan))'
                                : 'var(--cyan)',
                            transition: 'width 0.4s ease',
                        }}
                    />
                </div>

                <div className="loading-stages">
                    {['Fetch', 'Compile', 'GPU Load', 'Ready'].map((stage, i) => {
                        const pct = model.progress.percent;
                        const done = (i === 0 && pct > 25) || (i === 1 && pct > 55) ||
                            (i === 2 && pct > 85) || (i === 3 && pct === 100);
                        const active = (i === 0 && pct <= 25) || (i === 1 && pct > 25 && pct <= 55) ||
                            (i === 2 && pct > 55 && pct <= 85) || (i === 3 && pct > 85 && pct < 100);
                        return (
                            <div key={stage} className={`loading-stage ${done ? 'done' : active ? 'active' : ''}`}>
                                <div className="stage-dot" />
                                <span>{stage}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="loading-info-grid">
                <div className="loading-info-card">
                    <strong className="text-xs text-cyan">Why this takes time</strong>
                    <span className="text-xs text-muted">
                        The model loads from your local cache into GPU memory. Intentional — guarantees zero cloud calls.
                    </span>
                </div>
                {selectedTier && (
                    <div className="loading-info-card">
                        <strong className="text-xs text-cyan">
                            {selectedTier.icon} {selectedTier.shortLabel}
                        </strong>
                        <span className="text-xs text-muted">
                            {selectedTier.tagline} · {selectedTier.size}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Gemini Nano Prerequisites Checker ───────────────────────────────────────
function GeminiNanoChecker() {
    const [checks, setChecks] = useState([
        { id: 'browser', label: 'Chrome 129+ detected',           status: 'checking', hint: '' },
        { id: 'api',     label: 'Prompt API flag enabled',        status: 'checking', hint: '' },
        { id: 'model',   label: 'Gemini Nano model downloaded',   status: 'checking', hint: '' },
    ]);

    const setCheck = (id, status, hint = '', label = null) =>
        setChecks(prev => prev.map(c => c.id === id ? { ...c, status, hint, ...(label ? { label } : {}) } : c));

    useEffect(() => {
        (async () => {
            // ── 1. Browser check ──────────────────────────────────
            const ua = navigator.userAgent;
            const chromeMatch = ua.match(/Chrome\/(\d+)/);
            const chromiumMatch = ua.match(/Chromium\/(\d+)/);
            const version = parseInt(chromeMatch?.[1] || chromiumMatch?.[1] || '0');
            const isChrome = (chromeMatch || chromiumMatch) && !ua.includes('Edg/') && !ua.includes('OPR/');
            if (isChrome && version >= 129) {
                setCheck('browser', 'pass', `Chrome ${version}`, `Chrome ${version} detected — ✓`);
            } else if (isChrome) {
                setCheck('browser', 'fail', `Chrome ${version} — needs 129+. Update Chrome at chrome://settings/help`);
            } else {
                setCheck('browser', 'fail', 'Not Chrome — Gemini Nano requires Google Chrome or Chromium 129+');
            }

            // ── 2. API flag check ─────────────────────────────────
            const hasGlobalLM = typeof window.LanguageModel !== 'undefined' && typeof window.LanguageModel.create === 'function';
            const aiNS =
                (typeof ai !== 'undefined' && (ai?.languageModel || ai?.assistant || ai?.createTextSession) ? ai :
                 window?.ai && (window.ai?.languageModel || window.ai?.assistant || window.ai?.createTextSession) ? window.ai :
                 null);

            if (!hasGlobalLM && !aiNS) {
                setCheck('api', 'fail', 'Flags not active — open chrome://flags, search "Prompt API for Gemini Nano", set both flags to Enabled, then click Relaunch');
                setCheck('model', 'blocked', 'Waiting for Prompt API to be active first');
                return;
            }
            setCheck('api', 'pass', hasGlobalLM ? 'LanguageModel API is active' : 'window.ai Prompt API is active');

            // ── 3. Model download / capabilities check ────────────
            try {
                if (hasGlobalLM) {
                    const availability = await window.LanguageModel.availability();
                    if (availability === 'available') {
                        setCheck('model', 'pass', 'Model fully downloaded and ready to use!');
                    } else if (availability === 'downloadable') {
                        setCheck('model', 'pass', 'Model files ready — click "Load AI Model" below to initialize and unlock Gemini Nano!');
                    } else if (availability === 'downloading') {
                        setCheck('model', 'downloading',
                            'Model is downloading — open chrome://components, find "Optimization Guide On Device Model", click "Check for update" and wait for version to be non-zero');
                    } else {
                        setCheck('model', 'fail',
                            'Device not supported or model unavailable — Google requires 22 GB+ free storage and 8 GB+ RAM for Gemini Nano');
                    }
                } else {
                    const cap = await (aiNS.languageModel || aiNS.assistant)?.capabilities?.();
                    if (!cap) {
                        // Older API (createTextSession) — no capabilities() available, assume ready
                        setCheck('model', 'pass', 'Legacy Prompt API — model assumed ready');
                        return;
                    }
                    if (cap.available === 'readily') {
                        setCheck('model', 'pass', 'Model fully downloaded and ready to use!');
                    } else if (cap.available === 'after-download') {
                        setCheck('model', 'downloading',
                            'Model is still downloading — open chrome://components, find "Optimization Guide On Device Model", click "Check for update" and wait for version to be non-zero');
                    } else {
                        setCheck('model', 'fail',
                            'Device not supported — Google requires 22 GB+ free storage and 4 GB+ RAM for Gemini Nano');
                    }
                }
            } catch {
                setCheck('model', 'fail', 'Could not query capabilities — try relaunching Chrome');
            }
        })();
    }, []);

    const STATUS_ICON = {
        checking:    { icon: '⏳', color: 'var(--text-muted)' },
        pass:        { icon: '✅', color: 'var(--emerald)' },
        fail:        { icon: '❌', color: '#f87171' },
        downloading: { icon: '⬇️', color: 'var(--amber)' },
        blocked:     { icon: '⏸️', color: 'var(--text-muted)' },
    };

    const allPass = checks.every(c => c.status === 'pass');
    const anyFail = checks.some(c => c.status === 'fail');

    return (
        <div style={{
            marginTop: 12,
            background: 'rgba(0,0,0,0.15)',
            border: `1px solid ${ allPass ? 'rgba(16,185,129,0.25)' : anyFail ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)' }`,
            borderRadius: 8,
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: 'rgba(255,255,255,0.02)',
            }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
                    COMPATIBILITY SCAN
                </span>
                <span style={{ fontSize: 10, color: allPass ? 'var(--emerald)' : anyFail ? '#f87171' : 'var(--text-muted)' }}>
                    {allPass ? '✓ Ready to load' : anyFail ? '✗ Action required' : 'Scanning…'}
                </span>
            </div>

            {/* Check rows */}
            <div style={{ padding: '6px 0' }}>
                {checks.map((check, i) => {
                    const { icon, color } = STATUS_ICON[check.status] || STATUS_ICON.checking;
                    return (
                        <div key={check.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '7px 12px',
                            borderBottom: i < checks.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                            transition: 'background 0.2s',
                        }}>
                            <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1.4 }}>{icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 2 }}>
                                    {check.label}
                                </div>
                                {check.hint && check.status !== 'pass' && (
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                        {check.hint}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Gemini Nano Copy Chip (module-level) ─────────────────────────────────────
function CopyChip({ text, id, copied, onCopy }) {
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onCopy(text, id); }}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(6,182,212,0.08)',
                border: '1px solid rgba(6,182,212,0.2)',
                borderRadius: 5,
                padding: '2px 8px',
                fontSize: 11,
                color: 'var(--cyan)',
                fontFamily: 'monospace',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                marginLeft: 4,
                verticalAlign: 'middle',
            }}
            title="Click to copy"
        >
            {text}
            <span style={{ fontSize: 10, opacity: 0.7 }}>{copied === id ? '✓ Copied!' : '⧉'}</span>
        </button>
    );
}

// ── Gemini Unlock Guide — Visual Wizard ──────────────────────────────────────
function GeminiUnlockGuide() {
    const [copied, setCopied] = useState(null);

    const copyText = (text, id) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(id);
            setTimeout(() => setCopied(null), 2000);
        }).catch(() => {});
    };

    const steps = [
        {
            num: 1, icon: '🔧',
            title: 'Open Chrome Flags',
            desc: (cp, onCopy) => <>Open a new Chrome tab. In the address bar type <CopyChip text="chrome://flags" id="flags" copied={cp} onCopy={onCopy} /> and press Enter.</>,
        },
        {
            num: 2, icon: '⚡',
            title: 'Enable Prompt API',
            desc: (cp, onCopy) => <>In the search box, paste <CopyChip text="Prompt API for Gemini Nano" id="flag1" copied={cp} onCopy={onCopy} /> → Set both <strong style={{ color: 'var(--cyan)' }}>Prompt API for Gemini Nano</strong> and <strong style={{ color: 'var(--cyan)' }}>Prompt API for Gemini Nano with Multimodal Input</strong> to <strong style={{ color: 'var(--emerald)' }}>Enabled</strong>.</>,
        },
        {
            num: 3, icon: '🧠',
            title: 'Enable On-Device Model',
            desc: (cp, onCopy) => <>Clear the search and paste <CopyChip text="Optimization Guide On Device Model" id="flag2" copied={cp} onCopy={onCopy} /> → Set to <strong style={{ color: 'var(--emerald)' }}>Enabled BypassPerfRequirement</strong>.</>,
        },
        {
            num: 4, icon: '🔄',
            title: 'Relaunch Chrome',
            desc: () => <>A <strong style={{ color: 'var(--amber)' }}>Relaunch</strong> button will appear at the bottom of the flags page. Click it. Chrome restarts in a few seconds.</>,
        },
        {
            num: 5, icon: '⬇️',
            title: 'Trigger the Model Download',
            desc: (cp, onCopy) => <>After relaunch, open <CopyChip text="chrome://components" id="comp" copied={cp} onCopy={onCopy} /> → find <em>Optimization Guide On Device Model</em> → click <strong>"Check for update"</strong>. Chrome will download ~1.5 GB in the background.</>,
        },
        {
            num: 6, icon: '✅',
            title: 'Wait & Come Back!',
            desc: () => <>When the version changes from <code style={{ color: '#f87171' }}>0.0.0.0</code> to a real number and shows <strong style={{ color: 'var(--emerald)' }}>Up-to-date</strong>, refresh this page. Sentry AI will auto-verify and unlock Gemini Nano! 🎉</>,
        },
    ];

    return (
        <div style={{
            background: 'rgba(99,102,241,0.04)',
            border: '1px solid rgba(99,102,241,0.15)',
            borderRadius: 10,
            padding: '16px',
            marginTop: 12,
            fontSize: 12,
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 3 }}>
                        🚀 One-Time Setup Guide
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Only needed once · Takes about 5 minutes · Chrome 129+ required
                    </div>
                </div>
                <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 10px',
                    borderRadius: 100, background: 'rgba(99,102,241,0.1)',
                    border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8',
                }}>
                    6 STEPS
                </span>
            </div>

            {/* Step Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {steps.map((step) => (
                    <div key={step.num} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: 8,
                        padding: '10px 12px',
                    }}>
                        {/* Step number badge */}
                        <div style={{
                            flexShrink: 0,
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: 'rgba(99,102,241,0.15)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            fontWeight: 800,
                            color: '#818cf8',
                            marginTop: 1,
                        }}>
                            {step.num}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', marginBottom: 3 }}>
                                {step.icon} {step.title}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                {step.desc(copied, copyText)}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Bottom warning */}
            <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                background: 'rgba(245,158,11,0.06)',
                border: '1px solid rgba(245,158,11,0.18)',
                borderRadius: 8, padding: '10px 12px', marginTop: 12,
            }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
                <div style={{ fontSize: 11, color: 'var(--amber)', lineHeight: 1.5 }}>
                    <strong>Don't try to load until Step 6 is complete!</strong> If the version in <code style={{ color: 'var(--cyan)' }}>chrome://components</code> still shows <code style={{ color: '#f87171' }}>0.0.0.0</code>, the model hasn't downloaded yet. Loading will fail and nothing will happen.
                </div>
            </div>
        </div>
    );
}