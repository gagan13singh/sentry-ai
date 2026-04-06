// ================================================================
// Home.jsx — Onboarding / Model Loader page
// Hardware detection → model selection → download + boot
// ================================================================

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Cpu, Zap, Eye, Mic, Lock, ChevronRight,
  CheckCircle, AlertTriangle, RefreshCw, HardDrive
} from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { getAllModels } from '../lib/deviceProfile';
import '../App.css';

export default function Home() {
  const { model } = useApp();
  const navigate  = useNavigate();
  const [selectedModel, setSelectedModel] = useState(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Auto-detect on mount
  useEffect(() => {
    if (model.status === MODEL_STATUS.IDLE) {
      model.detectHardware();
    }
  }, []);

  // Set default selected model when profile detected
  useEffect(() => {
    if (model.hwProfile?.model && !selectedModel) {
      setSelectedModel(model.hwProfile.model.id);
    }
  }, [model.hwProfile]);

  const handleLoad = () => model.loadModel(selectedModel);
  const allModels  = getAllModels();

  const isLoading  = model.status === MODEL_STATUS.LOADING;
  const isChecking = model.status === MODEL_STATUS.CHECKING;
  const isReady    = model.status === MODEL_STATUS.READY;
  const isError    = model.status === MODEL_STATUS.ERROR;
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
              { icon: <Cpu size={14} />,  label: 'WebGPU Accelerated' },
              { icon: <Eye size={14} />,  label: 'Vision + OCR' },
              { icon: <Mic size={14} />,  label: 'Whisper Audio' },
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
              </div>
            )}

            {!hasProfile && model.status === MODEL_STATUS.IDLE && (
              <button className="btn btn-secondary btn-sm" onClick={model.detectHardware}>
                <RefreshCw size={14} /> Detect Hardware
              </button>
            )}
          </div>

          <div className="divider" />

          {/* Model selection */}
          {isError && (
            <div className="error-banner">
              <AlertTriangle size={16} />
              <span>{model.error}</span>
            </div>
          )}

          {hasProfile && !isReady && (
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

              <button
                className="btn btn-primary btn-lg w-full"
                onClick={handleLoad}
                disabled={isLoading || !model.hwProfile?.supportsWebGPU}
                style={{ marginTop: '16px' }}
              >
                {isLoading ? <><div className="spinner" style={{ borderTopColor: '#000' }} /> Loading…</> : <><Zap size={16} /> Launch Sentry AI</>}
              </button>

              {model.hwProfile && !model.hwProfile.supportsWebGPU && (
                <p className="text-xs text-amber" style={{ marginTop: 8, textAlign: 'center' }}>
                  WebGPU required. Use Chrome 113+ on a supported GPU.
                </p>
              )}
            </div>
          )}

          {/* Loading progress : "The Secure Handshake" */}
          {isLoading && (
            <div className="setup-block fade-in">
              <div className="divider" />
              
              <div className="setup-block-header" style={{ marginBottom: 16 }}>
                <Shield size={20} className="text-emerald" />
                <h3 className="text-emerald">Establishing Local Privacy</h3>
              </div>

              <p className="text-sm" style={{ marginBottom: 16 }}>
                Sentry AI is currently moving the AI Engine from your local hard drive into your GPU's Private Memory (VRAM).
              </p>

              <div className="progress-info" style={{ marginBottom: 8 }}>
                <span className="text-xs text-cyan truncate" style={{ maxWidth: '80%' }}>
                  Status: {model.progress.text || 'Loading from Disk (OPFS) ➔ GPU Memory...'}
                </span>
                <span className="text-sm text-cyan mono">{model.progress.percent}%</span>
              </div>
              
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${model.progress.percent}%`, background: 'var(--cyan)' }} />
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '20px' }}>
                <div style={{ marginBottom: 12 }}>
                  <strong className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Why this happens:</strong>
                  <span className="text-xs text-muted" style={{ display: 'block', lineHeight: 1.4 }}>To ensure 100% privacy, the browser "forgets" the AI whenever you close the tab.</span>
                </div>
                <div>
                  <strong className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>The 2026 Advantage:</strong>
                  <span className="text-xs text-muted" style={{ display: 'block', lineHeight: 1.4 }}>Because you've already downloaded the model, this is a "Warm Boot" — it takes just seconds to verify and load, rather than 10 minutes to download. (First time setups will download the model).</span>
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
                Model loaded into WebGPU memory. You're now air-gapped capable.
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
            { icon: <Lock size={20} className="text-cyan" />,    title: 'Zero Telemetry',   desc: 'No analytics, no tracking, no crash reports. Nothing.' },
            { icon: <HardDrive size={20} className="text-emerald" />, title: 'Local Storage', desc: 'All files, chats, and embeddings stay on your device.' },
            { icon: <Shield size={20} className="text-purple" />, title: 'Air-Gap Ready',    desc: 'Works fully offline once the model is downloaded.' },
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
