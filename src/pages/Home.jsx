// ================================================================
// Home.jsx — Onboarding / Model Loader page
// CHANGED: Static "Hardware Detection + Model Selection" setup block
//          replaced with <Diagnostic /> — the animated security scan.
// CHANGED: Sidebar nav label updated to "Home" (was "Setup").
// KEPT:    Hero section, promise grid, ready state, loading state.
// ================================================================

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Cpu, Zap, Eye, Mic, Lock, ChevronRight, CheckCircle, HardDrive } from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import Diagnostic from '../components/Diagnostic';
import '../App.css';

export default function Home() {
  const { model } = useApp();
  const navigate = useNavigate();

  const isReady = model.status === MODEL_STATUS.READY;

  // Auto-navigate to chat on model ready (optional — remove if you prefer manual nav)
  // Kept commented so the "Ready" card is always visible.
  // useEffect(() => { if (isReady) navigate('/chat'); }, [isReady]);

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

      {/* ── Setup / Diagnostic card ── */}
      <section className="setup-section">
        <div className="setup-card card fade-in">

          {/* ── Diagnostic scan (handles everything pre-launch) ── */}
          {!isReady && <Diagnostic />}

          {/* ── Ready state ── */}
          {isReady && (
            <div className="ready-state fade-in">
              <div className="ready-icon">
                <CheckCircle size={40} className="text-emerald" />
              </div>
              <h3 style={{ color: 'var(--emerald)' }}>Sentry AI is Ready</h3>
              <p className="text-sm text-muted" style={{ margin: '8px 0 8px' }}>
                Model loaded into WebGPU memory. You&apos;re now air-gapped capable.
              </p>
              {/* Show which engine is loaded */}
              {model.modelId && (
                <p className="text-xs text-muted" style={{ margin: '0 0 20px' }}>
                  Engine:{' '}
                  <span style={{ color: 'var(--cyan)', fontFamily: 'monospace' }}>
                    {model.modelId.includes('3B') ? '⚡ Sentry Turbo (3B)' : '🍃 Sentry Lite (1B)'}
                  </span>
                </p>
              )}
              <button className="btn btn-primary btn-lg" onClick={() => navigate('/chat')}>
                Start Chatting <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* ── Privacy promise cards (unchanged) ── */}
        <div className="promise-grid">
          {[
            {
              icon: <Lock size={20} className="text-cyan" />,
              title: 'Zero Telemetry',
              desc: 'No analytics, no tracking, no crash reports. Nothing.',
            },
            {
              icon: <HardDrive size={20} className="text-emerald" />,
              title: 'Local Storage',
              desc: 'All files, chats, and embeddings stay on your device.',
            },
            {
              icon: <Shield size={20} className="text-purple" />,
              title: 'Air-Gap Ready',
              desc: 'Works fully offline once the model is downloaded.',
            },
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