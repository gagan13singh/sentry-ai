// ================================================================
// Home.jsx — Onboarding / Model Loader page (PROD UI)
// Layout: Hero → Diagnostic setup card → Promise grid
// The Diagnostic component handles all scan + model selection logic
// ================================================================

import { Lock, Cpu, Eye, Mic, HardDrive, Shield } from 'lucide-react';
import Diagnostic from '../components/Diagnostic';
import '../App.css';
import '../pages/pages.css';

export default function Home() {
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
    </div>
  );
}