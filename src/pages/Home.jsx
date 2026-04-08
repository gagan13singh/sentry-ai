// ================================================================
// Home.jsx — Onboarding / Model Loader page (PROD UI)
// Layout: Hero → Diagnostic setup card → Promise grid
// The Diagnostic component handles all scan + model selection logic
// ================================================================

import { useState } from 'react';
import { Lock, Cpu, Eye, Mic, HardDrive, Shield, Info, X, ChevronDown, ChevronUp } from 'lucide-react';
import Diagnostic from '../components/Diagnostic';
import '../App.css';
import '../pages/pages.css';

export default function Home() {
  const [showAbout, setShowAbout] = useState(false);
  const [showDetailed, setShowDetailed] = useState(false);

  return (
    <div className="home-page">
      <div className="how-it-works-wrap fade-in">
        <button 
          className="btn btn-secondary" 
          onClick={() => setShowAbout(true)} 
          style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '100px', fontWeight: 500 }}
        >
          <Info size={16} /> How it Works
        </button>
      </div>

      {/* ── Hero ── */}
      <section className="hero-section">
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="hero-badge fade-in">
            <Lock size={12} />
            Zero cloud calls · Runs on your GPU
          </div>

          <h1 className="hero-title slide-up">
            The AI that runs on your device,<br />
            <span className="gradient-text">not in the cloud.</span>
          </h1>

          <p className="hero-sub slide-up" style={{ animationDelay: '0.1s' }}>
            100% private. Zero server tracking. Works completely offline.
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

      {/* ── Setup card containing the Diagnostic scan ── */}
      <section className="setup-section">
        <div className="setup-card card fade-in">
          <Diagnostic />
        </div>

        {/* ── Promise cards ── */}
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

      {/* ── About Modal ── */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <h3>How Sentry AI Works</h3>
              <button className="btn-icon" onClick={() => setShowAbout(false)}><X size={18} /></button>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '75vh', overflowY: 'auto', paddingRight: '12px' }}>
              <div>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                  <Lock size={16} className="text-cyan" /> 1. Your Data Never Leaves Your Screen
                </h4>
                <p className="text-sm text-muted" style={{ marginTop: '4px', lineHeight: 1.5 }}>
                  Unlike traditional AI that sends your files to corporate servers, Sentry AI downloads a miniature "brain" directly into your browser. Once it loads, you can turn off your Wi-Fi and it will still work.
                </p>
              </div>

              <div>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                  <Cpu size={16} className="text-emerald" /> 2. Hardware-Adaptive Intelligence
                </h4>
                <p className="text-sm text-muted" style={{ marginTop: '4px', lineHeight: 1.5 }}>
                  Sentry automatically scans your device to give you the best experience. If you are on a high-end laptop, it runs a powerful model. If you are on a mobile phone, it switches to a lightweight, highly-efficient engine to save battery and prevent crashes.
                </p>
              </div>

              <div>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                  <Shield size={16} className="text-purple" /> 3. Built for Tasks, Not Trivia
                </h4>
                <p className="text-sm text-muted" style={{ marginTop: '4px', lineHeight: 1.5 }}>
                  Because Sentry runs locally, it doesn't have the storage to memorize the whole internet. Instead of asking it for historical facts, use it as your private assistant: drop in a PDF to summarize, ask it to fix your grammar, or extract text from an image.
                </p>
              </div>

              <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 20 }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', justifyContent: 'space-between', padding: '12px 16px', borderRadius: '8px' }}
                  onClick={() => setShowDetailed(!showDetailed)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}><Cpu size={15}/> View Detailed Architecture</span>
                  {showDetailed ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                </button>
                
                {showDetailed && (
                  <div className="fade-in" style={{ marginTop: 16, padding: '20px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.6, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p style={{ marginBottom: 16 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>WebGPU Execution:</strong> Sentry relies on the WebGPU API to run highly compressed (4-bit quantized) Large Language Models directly in the browser's GPU context. This avoids expensive memory offloading.
                    </p>
                    <p style={{ marginBottom: 16 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>CPU/WASM Fallback:</strong> If a device lacks WebGPU support, Sentry seamlessly routes execution through a purely WebAssembly-based ONNX runtime (via Transformers.js) for universal device compatibility.
                    </p>
                    <p>
                      <strong style={{ color: 'var(--text-primary)' }}>Local RAG (Vector Database):</strong> When you upload a document, Sentry generates local embeddings via a MiniLM model. These embeddings are securely stowed in your browser's Origin Private File System (OPFS), constructing a 100% air-gapped Retrieval-Augmented Generation pipeline.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}