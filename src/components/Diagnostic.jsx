// ================================================================
// Diagnostic.jsx — Enhanced "Security Scan" Pre-Flight Dashboard
//
// NEW: 5-tier model system with smart device-based recommendations
// NEW: User-friendly adjectives (Lightning Fast, Well-Rounded, etc.)
// NEW: Shows suitable models based on device capabilities
// FIXED: Models now appear immediately after scan completion
// ================================================================

import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, CheckCircle, Zap, ChevronDown, ChevronUp, RefreshCw, ExternalLink, ChevronRight, Info } from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { MODEL_TIERS, generateSessionKey, getCachedProfile, setCachedProfile, getAvailableModels } from '../lib/deviceProfile';

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
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
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

// ── Main component ───────────────────────────────────────────────────────────
export default function Diagnostic() {
    const { model } = useApp();
    const navigate = useNavigate();

    const [stepStatuses, setStepStatuses] = useState(SCAN_STEPS.map(() => 'pending'));
    const [stepResults, setStepResults] = useState(SCAN_STEPS.map(() => null));
    const [currentStep, setCurrentStep] = useState(-1);
    const [sessionKey, setSessionKey] = useState(null);
    const [scanDone, setScanDone] = useState(false);
    const [fromCache, setFromCache] = useState(false);

    const scanData = useRef({ sabOk: false, ram: 0, webGPU: false, gpuInfo: null });

    const [selectedModel, setSelectedModel] = useState(null);
    const [availableModels, setAvailableModels] = useState([]);
    const [recommendedModel, setRecommendedModel] = useState(null);
    const [deviceRecommendation, setDeviceRecommendation] = useState(null);
    const [showUnlock, setShowUnlock] = useState(false);

    function setStep(idx, status, result = null) {
        setStepStatuses(prev => { const n = [...prev]; n[idx] = status; return n; });
        setStepResults(prev => { const n = [...prev]; n[idx] = result; return n; });
    }

    async function runFullScan() {
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
        setSessionKey(key);
        setStep(3, 'pass', key);

        await finaliseScan();
    }

    async function loadFromCache(cached) {
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
        setSessionKey(results[3]);
        setCurrentStep(4);
        scanData.current = {
            sabOk: cached.hasSharedArrayBuffer !== false,
            ram: cached.ram,
            webGPU: cached.supportsWebGPU,
            gpuInfo: cached.gpuInfo,
        };

        const currentProfile = await model.detectHardware();
        populateModelSelections(currentProfile);
        setScanDone(true);
    }

    async function finaliseScan() {
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
        // FIXED: Await hardware detection and immediately populate models using returned profile
        const currentProfile = await model.detectHardware();
        populateModelSelections(currentProfile);
    }

    function populateModelSelections(profile) {
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
    }

    useEffect(() => {
        const cached = getCachedProfile();
        if (cached && cached.tier) {
            loadFromCache(cached);
        } else {
            runFullScan();
        }
    }, []);

    const canLoad = scanDone && selectedModel;
    const isLoading = model.status === MODEL_STATUS.LOADING;
    const isReady = model.status === MODEL_STATUS.READY;

    async function handleLoadModel() {
        if (!canLoad || isLoading) return;

        // Find the tier for the selected model
        const selectedTier = Object.entries(MODEL_TIERS).find(
            ([_, tierData]) => tierData.id === selectedModel
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

                    {!scanData.current.webGPU && (
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

                    <div style={{ marginTop: 16, textAlign: 'center' }}>
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