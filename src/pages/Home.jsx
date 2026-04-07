// ================================================================
// Home.jsx — Onboarding / Model Loader page
// FIXED: Full mobile responsiveness during download progress
// FIXED: SharedArrayBuffer availability check shown to user
// FIXED: Mobile model override notice (forced 1B for stability)
// FIXED: All text readable on small screens, no overflow
// ================================================================

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Cpu, Zap, Eye, Mic, Lock, ChevronRight,
  CheckCircle, AlertTriangle, RefreshCw, HardDrive, Smartphone
} from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { getAllModels } from '../lib/deviceProfile';
import '../App.css';

export default function Home() {
  const { model } = useApp();
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  useEffect(() => {
    if (model.status === MODEL_STATUS.IDLE) {
      model.detectHardware();
    }
  }, []);

  useEffect(() => {
    if (model.hwProfile?.model && !selectedModel) {
      setSelectedModel(model.hwProfile.model.id);
    }
  }, [model.hwProfile]);

  const handleLoad = () => model.loadModel(selectedModel);
  const allModels = getAllModels();

  const isLoading = model.status === MODEL_STATUS.LOADING;
  const isChecking = model.status === MODEL_STATUS.CHECKING;
  const isReady = model.status === MODEL_STATUS.READY;
  const isError = model.status === MODEL_STATUS.ERROR;
  const hasProfile = !!model.hwProfile;

  return (
    <div className="home-page">
      {/* ── Hero ── */}
      <section className="hero-section">
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="hero-badge fade-in">
            <Lock size={12} />
            Zero cloud calls · Runs on your GPU
          </div>

          <h1 className="hero-title slide-up">
            The AI that<br />
            <span className="gradient-text">never phones home.</span>
          </h1>

          <p className="hero-sub slide-up" style={{ animationDelay: '0.1s' }}>
            Sentry AI runs entirely in your browser using WebGPU.<br />
            Your data never leaves your device. Not even one byte.
          </p>

          <div className="feature-pills fade-in" style={{ animationDelay: '0.2s' }}>
            {[
              { icon: <Cpu size={14} />, label: 'WebGPU Accelerated' },
              { icon: <Eye size={14} />, label: 'Vision + OCR' },
              { icon: <Mic size={14} />, label: 'Whisper Audio' },
              { icon: <HardDrive size={14} />, label: 'OPFS Cached' },
            ].map(f => (
              <span key={f.label} className="feature-pill">
                {f.icon} {f.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Setup card ── */}
      <section className="setup-section">
        <div className="setup-card card fade-in">

          {/* SAB / COOP warning — shown when deployment headers are missing */}
          {!model.sabAvailable && (
            <div className="error-banner" style={{ marginBottom: 16 }}>
              <AlertTriangle size={16} />
              <span>
                <strong>Browser isolation headers missing.</strong> Cross-Origin-Opener-Policy and
                Cross-Origin-Embedder-Policy must be set on your server for WebLLM to work.
                If you&apos;re on Vercel, add the included <code>vercel.json</code> to your project root.
              </span>
            </div>
          )}

          {/* Mobile notice */}
          {model.isMobile && (
            <div className="mobile-notice fade-in">
              <Smartphone size={15} />
              <span>
                <strong>Mobile detected.</strong> Using the 1B model for stability —
                prevents GPU memory crashes on mobile browsers.
              </span>
            </div>
          )}

          {/* Hardware detection */}
          <div className="setup-block">
            <div className="setup-block-header">
              <Cpu size={18} className="text-cyan" />
              <h3>Hardware Detection</h3>
            </div>

            {isChecking && (
              <div className="flex items-center gap-3" style={{ padding: '12px 0' }}>
                <div className="spinner" />
                <span className="text-sm text-muted">Probing your GPU…</span>
              </div>
            )}

            {hasProfile && !isChecking && (
              <div className="hw-grid">
                <HWCard label="RAM" value={`${model.hwProfile.ram} GB`} />
                <HWCard
                  label="WebGPU"
                  value={model.hwProfile.supportsWebGPU ? 'Supported ✓' : 'Not found ✗'}
                  accent={model.hwProfile.supportsWebGPU ? 'emerald' : 'red'}
                />
                {model.hwProfile.gpuInfo && (
                  <HWCard
                    label="GPU"
                    value={model.hwProfile.gpuInfo.description || model.hwProfile.gpuInfo.vendor}
                    wide
                  />
                )}
                {model.hwProfile.mobileOverride && (
                  <HWCard label="Mode" value="Mobile-Safe" accent="amber" wide />
                )}
              </div>
            )}

            {!hasProfile && model.status === MODEL_STATUS.IDLE && (
              <button className="btn btn-secondary btn-sm" onClick={model.detectHardware}>
                <RefreshCw size={14} /> Detect Hardware
              </button>
            )}
          </div>

          <div className="divider" />

          {isError && (
            <div className="error-banner">
              <AlertTriangle size={16} />
              <span>{model.error}</span>
            </div>
          )}

          {/* Model selection — hidden on mobile (always 1B) */}
          {hasProfile && !isReady && !model.isMobile && (
            <div className="setup-block">
              <div className="setup-block-header">
                <Zap size={18} className="text-cyan" />
                <h3>Model Selection</h3>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setShowModelPicker(!showModelPicker)}
                >
                  {showModelPicker ? 'Auto-select' : 'Manual'}
                </button>
              </div>

              {!showModelPicker && model.hwProfile?.model && (
                <div className="recommended-model">
                  <div className="rec-label">Recommended for your hardware</div>
                  <div className="rec-model-name">{model.hwProfile.model.label}</div>
                  <div className="rec-model-size text-muted text-sm">{model.hwProfile.model.size} download</div>
                </div>
              )}

              {showModelPicker && (
                <div className="model-list">
                  {allModels.map(m => (
                    <label key={m.id} className={`model-option ${selectedModel === m.id ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="model"
                        value={m.id}
                        checked={selectedModel === m.id}
                        onChange={() => setSelectedModel(m.id)}
                      />
                      <div className="model-option-info">
                        <span className="model-option-label">{m.label}</span>
                        <span className="text-xs text-muted">{m.size}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mobile: show fixed model info */}
          {hasProfile && !isReady && model.isMobile && !isLoading && (
            <div className="setup-block">
              <div className="setup-block-header">
                <Zap size={18} className="text-cyan" />
                <h3>Model</h3>
              </div>
              <div className="recommended-model">
                <div className="rec-label">Mobile-Optimized</div>
                <div className="rec-model-name">Llama 3.2 · 1B · Efficient</div>
                <div className="rec-model-size text-muted text-sm">~0.9 GB · Stable on mobile GPU</div>
              </div>
            </div>
          )}

          {/* Launch button — shown when profile ready and not yet loading/ready */}
          {hasProfile && !isReady && !isLoading && (
            <button
              className="btn btn-primary btn-lg w-full"
              onClick={handleLoad}
              disabled={!model.hwProfile?.supportsWebGPU || !model.sabAvailable}
              style={{ marginTop: '16px' }}
            >
              <Zap size={16} /> Launch Sentry AI
            </button>
          )}

          {hasProfile && !model.hwProfile.supportsWebGPU && (
            <p className="text-xs text-amber" style={{ marginTop: 8, textAlign: 'center' }}>
              WebGPU required. Use Chrome 113+ on a supported GPU.
            </p>
          )}

          {/* ── Loading progress — FULLY MOBILE RESPONSIVE ── */}
          {isLoading && (
            <div className="setup-block loading-block fade-in">
              <div className="divider" />

              <div className="loading-header">
                <Shield size={20} className="text-emerald" />
                <h3 className="text-emerald">Establishing Local Privacy</h3>
              </div>

              {/* Progress display — mobile-safe layout */}
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

                {/* Stage indicator */}
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

              {/* Info cards — stack on mobile */}
              <div className="loading-info-grid">
                <div className="loading-info-card">
                  <strong className="text-xs text-cyan">Why this takes time</strong>
                  <span className="text-xs text-muted">
                    The browser loads the AI model from your local storage into GPU memory on every new session.
                    This is intentional — it guarantees zero cloud calls.
                  </span>
                </div>
                <div className="loading-info-card">
                  <strong className="text-xs text-cyan">
                    {model.isMobile ? '📱 Mobile Mode' : '⚡ Warm Boot'}
                  </strong>
                  <span className="text-xs text-muted">
                    {model.isMobile
                      ? 'Using 1B model with mobile-safe GPU settings to prevent crashes.'
                      : 'Model is already cached — this is faster than re-downloading.'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Ready state */}
          {isReady && (
            <div className="ready-state fade-in">
              <div className="ready-icon">
                <CheckCircle size={40} className="text-emerald" />
              </div>
              <h3 style={{ color: 'var(--emerald)' }}>Sentry AI is Ready</h3>
              <p className="text-sm text-muted" style={{ margin: '8px 0 24px' }}>
                Model loaded into WebGPU memory. You&apos;re now air-gapped capable.
              </p>
              <button className="btn btn-primary btn-lg" onClick={() => navigate('/chat')}>
                Start Chatting <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Privacy promise cards */}
        <div className="promise-grid">
          {[
            { icon: <Lock size={20} className="text-cyan" />, title: 'Zero Telemetry', desc: 'No analytics, no tracking, no crash reports. Nothing.' },
            { icon: <HardDrive size={20} className="text-emerald" />, title: 'Local Storage', desc: 'All files, chats, and embeddings stay on your device.' },
            { icon: <Shield size={20} className="text-purple" />, title: 'Air-Gap Ready', desc: 'Works fully offline once the model is downloaded.' },
          ].map(p => (
            <div key={p.title} className="promise-card card">
              {p.icon}
              <h4>{p.title}</h4>
              <p className="text-sm">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HWCard({ label, value, accent = 'cyan', wide = false }) {
  return (
    <div className={`hw-card ${wide ? 'hw-card-wide' : ''}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`hw-value text-${accent}`}>{value}</div>
    </div>
  );
}