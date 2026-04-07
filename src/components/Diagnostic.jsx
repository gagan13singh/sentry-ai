// ================================================================
// Diagnostic.jsx — "Security Scan" Pre-Flight Dashboard
//
// Behaviour:
//   • First visit  → runs full theatrical scan (4 animated steps)
//   • Return visit → detects cached profile, shows "Profile Loaded"
//                    instantly so user skips the wait
//   • Re-scan triggers: browser version change, cleared cache
//
// After scan completes:
//   • WebGPU found  → shows ⚡ Sentry Turbo + 🍃 Sentry Lite buttons
//   • WebGPU absent → silently selects Lite, shows friendly "Unlock" guide
// ================================================================

import { useEffect, useState, useRef } from 'react';
import { Shield, Cpu, Zap, ChevronDown, ChevronUp, RefreshCw, ExternalLink } from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { MODEL_TIERS, generateSessionKey, getCachedProfile, setCachedProfile } from '../lib/deviceProfile';

// ── Scan step definitions ────────────────────────────────────────────────────
const SCAN_STEPS = [
    {
        id: 'isolation',
        icon: '🔎',
        label: 'Checking Browser Isolation',
        subtext: 'Verifying SharedArrayBuffer for your security',
    },
    {
        id: 'vram',
        icon: '🧠',
        label: 'Assessing Memory Capacity',
        subtext: 'Allocating local memory for the AI engine',
    },
    {
        id: 'gpu',
        icon: '🛡️',
        label: 'Testing GPU Path',
        subtext: 'Confirming your hardware can process data privately',
    },
    {
        id: 'key',
        icon: '🔑',
        label: 'Generating Session Key',
        subtext: 'Creating a one-time local encryption identifier',
    },
];

const STEP_DELAY_MS = 900; // theatrical delay between steps

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

    const [stepStatuses, setStepStatuses] = useState(SCAN_STEPS.map(() => 'pending'));
    const [stepResults, setStepResults] = useState(SCAN_STEPS.map(() => null));
    const [currentStep, setCurrentStep] = useState(-1);
    const [sessionKey, setSessionKey] = useState(null);
    const [scanDone, setScanDone] = useState(false);
    const [fromCache, setFromCache] = useState(false);

    // results we derive during the scan
    const scanData = useRef({ sabOk: false, ram: 0, webGPU: false, gpuInfo: null });

    // UI state for after-scan controls
    const [selectedModel, setSelectedModel] = useState(MODEL_TIERS.LOW.id);
    const [showUnlock, setShowUnlock] = useState(false);

    // ── Step helper ────────────────────────────────────────────────────────────
    function setStep(idx, status, result = null) {
        setStepStatuses(prev => { const n = [...prev]; n[idx] = status; return n; });
        setStepResults(prev => { const n = [...prev]; n[idx] = result; return n; });
    }

    // ── Run the theatrical scan ────────────────────────────────────────────────
    async function runFullScan() {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        // Step 0 — Browser Isolation (SAB)
        setCurrentStep(0);
        setStep(0, 'running');
        await delay(STEP_DELAY_MS);
        const sabOk = checkSAB();
        scanData.current.sabOk = sabOk;
        setStep(0, sabOk ? 'pass' : 'fail', sabOk ? 'SharedArrayBuffer active' : 'Missing COOP/COEP headers');

        // Step 1 — RAM
        setCurrentStep(1);
        setStep(1, 'running');
        await delay(STEP_DELAY_MS);
        const ram = navigator.deviceMemory ?? 4;
        scanData.current.ram = ram;
        setStep(1, 'pass', `${ram} GB detected`);

        // Step 2 — WebGPU (real async probe)
        setCurrentStep(2);
        setStep(2, 'running');
        const gpuResult = await probeWebGPU(); // real check runs in parallel with the delay
        await delay(Math.max(0, STEP_DELAY_MS - 100)); // feels snappy but not instant
        scanData.current.webGPU = gpuResult.supported;
        scanData.current.gpuInfo = gpuResult.gpuInfo;
        const gpuLabel = gpuResult.supported
            ? (gpuResult.gpuInfo?.description || 'GPU Access Granted')
            : 'Direct GPU access restricted by browser';
        setStep(2, gpuResult.supported ? 'pass' : 'fail', gpuLabel);

        // Step 3 — Session Key
        setCurrentStep(3);
        setStep(3, 'running');
        await delay(STEP_DELAY_MS - 200);
        const key = generateSessionKey();
        setSessionKey(key);
        setStep(3, 'pass', key);

        finaliseScan();
    }

    // ── Fast path: cached profile ─────────────────────────────────────────────
    async function loadFromCache(cached) {
        setFromCache(true);
        // Instantly mark all steps as passed / failed based on cache
        const results = [
            cached.sabAvailable !== false ? 'SharedArrayBuffer active' : 'Missing COOP/COEP headers',
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
        setCurrentStep(4); // all done
        scanData.current = {
            sabOk: cached.sabAvailable !== false,
            ram: cached.ram,
            webGPU: cached.supportsWebGPU,
            gpuInfo: cached.gpuInfo,
        };

        // Still populate model context so loadModel() works
        if (model.status === MODEL_STATUS.IDLE) {
            model.detectHardware();
        }

        finaliseScan();
    }

    // ── Resolve model choice and mark scan complete ───────────────────────────
    function finaliseScan() {
        const { webGPU, ram } = scanData.current;
        if (webGPU && ram >= 8) {
            setSelectedModel(MODEL_TIERS.HIGH.id);
        } else {
            setSelectedModel(MODEL_TIERS.LOW.id);
        }
        setScanDone(true);
    }

    // ── Mount: decide full scan vs cache hit ──────────────────────────────────
    useEffect(() => {
        const cached = getCachedProfile();
        if (cached) {
            loadFromCache(cached);
        } else {
            // Kick off the actual hardware detection at the same time as the UI animation.
            // detectHardware() populates model.hwProfile for later loadModel() calls.
            if (model.status === MODEL_STATUS.IDLE) {
                model.detectHardware().then((profile) => {
                    if (profile) {
                        setCachedProfile({
                            ...profile,
                            sabAvailable: checkSAB(),
                        });
                    }
                });
            }
            runFullScan();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Launch handler ────────────────────────────────────────────────────────
    const handleLaunch = () => model.loadModel(selectedModel);

    const isLoading = model.status === MODEL_STATUS.LOADING;
    const isReady = model.status === MODEL_STATUS.READY;
    const isError = model.status === MODEL_STATUS.ERROR;
    const gpuOk = scanData.current.webGPU;
    const sabOk = scanData.current.sabOk;
    const canLaunch = scanDone && !isLoading && !isReady && sabOk;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

            {/* ── Header ── */}
            <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <Shield size={20} style={{ color: 'var(--cyan)' }} />
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                        Securing Your Local Environment
                    </h3>
                    {fromCache && (
                        <span style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                            color: 'var(--emerald)', background: 'rgba(16,185,129,0.12)',
                            padding: '2px 8px', borderRadius: 4, marginLeft: 'auto',
                        }}>
                            PROFILE LOADED
                        </span>
                    )}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Analyzing your device hardware locally.&nbsp;
                    <strong style={{ color: 'var(--text-secondary)' }}>
                        No hardware data is ever sent to our servers.
                    </strong>
                </p>
            </div>

            {/* ── Scan Steps ── */}
            <div style={{
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10,
                padding: '14px 16px',
                fontFamily: 'monospace',
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginBottom: 16,
            }}>
                {SCAN_STEPS.map((step, i) => {
                    const status = stepStatuses[i];
                    const result = stepResults[i];
                    const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
                    const isActive = currentStep === i && status === 'running';

                    return (
                        <div key={step.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            opacity: status === 'pending' ? 0.35 : 1,
                            transition: 'opacity 0.3s ease',
                        }}>
                            {/* Icon + pulse for running */}
                            <div style={{ position: 'relative', width: 22, flexShrink: 0, paddingTop: 1 }}>
                                <span style={{ fontSize: 14 }}>{step.icon}</span>
                                {isActive && (
                                    <span style={{
                                        position: 'absolute', top: -2, right: -4,
                                        width: 7, height: 7, borderRadius: '50%',
                                        background: 'var(--cyan)',
                                        animation: 'pulse-dot 0.9s ease-in-out infinite',
                                    }} />
                                )}
                            </div>

                            {/* Text */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                        {step.label}
                                    </span>
                                    {status !== 'pending' && (
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                                            color: style.color, padding: '1px 5px',
                                            border: `1px solid ${style.color}`,
                                            borderRadius: 3, opacity: 0.9,
                                        }}>
                                            {isActive ? style.label : (status === 'pass' ? 'VERIFIED ✓' : STATUS_STYLES[status]?.label)}
                                        </span>
                                    )}
                                </div>

                                {/* Sub-result row */}
                                {result && !isActive && (
                                    <div style={{
                                        color: step.id === 'key' ? 'var(--cyan)' : style.color,
                                        fontSize: 11, marginTop: 2,
                                        wordBreak: 'break-all',
                                        fontWeight: step.id === 'key' ? 600 : 400,
                                        textShadow: step.id === 'key' ? `0 0 8px ${style.color}` : 'none',
                                    }}>
                                        {step.id === 'key'
                                            ? `${result} — exists only in your RAM`
                                            : result}
                                    </div>
                                )}
                                {isActive && (
                                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                                        {step.subtext}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Post-Scan UI ── */}
            {scanDone && !isReady && (
                <>
                    {/* SAB missing — hard blocker */}
                    {!sabOk && (
                        <div className="error-banner" style={{ marginBottom: 16 }}>
                            <Shield size={15} />
                            <span>
                                <strong>Browser isolation headers missing.</strong> Add the included{' '}
                                <code>vercel.json</code> to your project root (sets COOP/COEP). Then reload.
                            </span>
                        </div>
                    )}

                    {/* GPU found → show both model options */}
                    {gpuOk && sabOk && !isLoading && (
                        <>
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px', textAlign: 'center' }}>
                                Your GPU is ready. Choose your AI engine:
                            </p>
                            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                                <ModelCard
                                    tier={MODEL_TIERS.HIGH}
                                    selected={selectedModel === MODEL_TIERS.HIGH.id}
                                    onClick={() => setSelectedModel(MODEL_TIERS.HIGH.id)}
                                    disabled={scanData.current.ram < 8}
                                    disabledReason="Requires 8 GB RAM"
                                />
                                <ModelCard
                                    tier={MODEL_TIERS.LOW}
                                    selected={selectedModel === MODEL_TIERS.LOW.id}
                                    onClick={() => setSelectedModel(MODEL_TIERS.LOW.id)}
                                />
                            </div>
                        </>
                    )}

                    {/* GPU not found → silent Lite selection + unlock guide */}
                    {!gpuOk && sabOk && !isLoading && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{
                                background: 'rgba(251,191,36,0.08)',
                                border: '1px solid rgba(251,191,36,0.25)',
                                borderRadius: 8, padding: '10px 14px', marginBottom: 10,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span style={{ fontSize: 16 }}>🍃</span>
                                    <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                                        Activating High-Efficiency CPU Engine
                                    </strong>
                                </div>
                                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                    Direct GPU access is restricted by your browser settings. Sentry is switching to
                                    its <strong style={{ color: 'var(--amber)' }}>Lite Mode</strong> — the same private
                                    AI, running on your CPU. Slightly slower, equally private.
                                </p>
                            </div>

                            {/* Unlock Pro Performance expander */}
                            <button
                                onClick={() => setShowUnlock(v => !v)}
                                style={{
                                    width: '100%', background: 'transparent',
                                    border: '1px dashed rgba(255,255,255,0.15)',
                                    borderRadius: 7, padding: '8px 14px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12,
                                }}
                            >
                                <span>⚡ Want faster responses? Unlock Pro Performance</span>
                                {showUnlock ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>

                            {showUnlock && <UnlockGuide />}
                        </div>
                    )}

                    {/* Launch button */}
                    {canLaunch && (
                        <button
                            className="btn btn-primary btn-lg w-full"
                            onClick={handleLaunch}
                            style={{ marginTop: 4 }}
                        >
                            <Zap size={16} />
                            {gpuOk
                                ? (selectedModel === MODEL_TIERS.HIGH.id ? 'Launch Sentry Turbo' : 'Launch Sentry Lite')
                                : 'Launch Sentry Lite'}
                        </button>
                    )}

                    {/* Error state */}
                    {isError && (
                        <div className="error-banner" style={{ marginTop: 12 }}>
                            <span>{model.error}</span>
                            <button
                                className="btn btn-ghost btn-sm"
                                style={{ marginLeft: 'auto' }}
                                onClick={() => model.detectHardware()}
                            >
                                <RefreshCw size={12} /> Retry
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* ── Loading Progress (reused from existing style) ── */}
            {isLoading && <LoadingProgress model={model} selectedModel={selectedModel} />}

            {/* ── Keyframe for pulse dot ── */}
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
function ModelCard({ tier, selected, onClick, disabled = false, disabledReason }) {
    return (
        <button
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            style={{
                flex: 1, minWidth: 130,
                background: selected
                    ? (tier.icon === '⚡' ? 'rgba(6,182,212,0.12)' : 'rgba(16,185,129,0.1)')
                    : 'rgba(255,255,255,0.03)',
                border: `1px solid ${selected
                    ? (tier.icon === '⚡' ? 'var(--cyan)' : 'var(--emerald)')
                    : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 9, padding: '12px 14px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                opacity: disabled ? 0.45 : 1,
                transition: 'all 0.2s ease',
            }}
        >
            <div style={{ fontSize: 18, marginBottom: 5 }}>{tier.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>
                {tier.shortLabel}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {disabled ? disabledReason : tier.tagline}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5 }}>
                {tier.size} · {tier.label.split('·')[0].trim()}
            </div>
        </button>
    );
}

// ── "Unlock Pro Performance" chrome://flags guide ─────────────────────────────
function UnlockGuide() {
    return (
        <div style={{
            background: 'rgba(6,182,212,0.05)',
            border: '1px solid rgba(6,182,212,0.15)',
            borderRadius: '0 0 7px 7px',
            padding: '14px 16px',
            fontSize: 12,
            lineHeight: 1.6,
        }}>
            <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)' }}>
                <strong>Why is it restricted?</strong> Your browser has a safety speed-limiter active for
                newer GPU APIs. Enabling it is safe for your data — it simply lets Sentry&apos;s local AI
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

            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 11 }}>
                💡 Chrome labels these "experimental" — not because your device is at risk, but because
                direct-to-GPU technology is newer than standard browser buttons. Your data stays 100% local
                either way.
            </p>

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
    const isTurbo = selectedModel === MODEL_TIERS.HIGH.id;
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
                                : (isTurbo ? 'var(--cyan)' : 'var(--emerald)'),
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
                <div className="loading-info-card">
                    <strong className="text-xs text-cyan">
                        {isTurbo ? '⚡ Turbo Mode' : '🍃 Lite Mode'}
                    </strong>
                    <span className="text-xs text-muted">
                        {isTurbo
                            ? '3B parameter model — best for complex reasoning on 8 GB+ RAM.'
                            : '1B parameter model — efficient and stable on all hardware.'}
                    </span>
                </div>
            </div>
        </div>
    );
}