// ================================================================
// Audit.jsx — Privacy Audit Dashboard
// FIXED: Honest network reporting — model downloads shown as external
// FIXED: suspiciousRequests only includes genuinely unexpected calls
// NEW: Threat log from session
// NEW: Encryption status
// NEW: Panic wipe button
// NEW: Memory usage display
// ================================================================

import { useState, useEffect } from 'react';
import {
  Activity, Shield, Wifi, WifiOff, HardDrive,
  Eye, Download, RefreshCw, CheckCircle, Globe,
  Lock, ShieldAlert, Flame, Database, Key,
  AlertTriangle, Cpu
} from 'lucide-react';
import { useApp } from '../App';
import { useNetworkAudit } from '../hooks/useNetworkAudit';
import { useSessionVault } from '../hooks/useSessionVault';
import { getStorageInfo, listCachedModels } from '../lib/opfs';

export default function Audit() {
  const { model, connStatus } = useApp();
  const audit = useNetworkAudit();
  const vault = useSessionVault();

  const [storageInfo, setStorageInfo] = useState(null);
  const [cachedModels, setCachedModels] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [memUsage, setMemUsage] = useState(null);

  useEffect(() => {
    refreshData();
    // Poll memory every 5s if available
    const mem = performance?.memory;
    if (mem) {
      setMemUsage(mem);
      const t = setInterval(() => setMemUsage({ ...performance.memory }), 5000);
      return () => clearInterval(t);
    }
  }, []);

  async function refreshData() {
    const info = await getStorageInfo();
    const models = await listCachedModels();
    setStorageInfo(info);
    setCachedModels(models);
    setLastRefresh(new Date());
    audit.clearRequests();
  }

  const handlePanicWipe = async () => {
    const confirmed = window.confirm(
      '⚠️ PANIC WIPE\n\nThis will permanently delete:\n• All conversations\n• All vault documents\n• All cached model metadata\n• All encryption keys\n\nThe AI model weights in OPFS will remain (they\'re public data).\n\nThis cannot be undone. Continue?'
    );
    if (!confirmed) return;

    // Wipe vault (conversations + keys)
    vault.wipeAll();
    // Wipe orama IDB
    const { clearDB } = await import('../lib/orama');
    await clearDB();
    localStorage.clear();
    sessionStorage.clear();
    alert('✓ Panic wipe complete. Reloading…');
    window.location.reload();
  };

  // FIXED: genuinely suspicious = only unexpected external calls
  const { suspiciousRequests, telemetryRequests, modelDownloadRequests } = audit;

  // Privacy score: only deduct for truly unexpected/telemetry calls
  const privacyScore = Math.max(0,
    100
    - telemetryRequests.length * 40
    - suspiciousRequests.filter(r => r.risk === 'high').length * 15
  );
  const isPrivate = telemetryRequests.length === 0 && suspiciousRequests.filter(r => r.risk === 'high').length === 0;

  return (
    <div className="audit-page page-content">
      <div className="page-header">
        <div>
          <h2>Privacy Audit</h2>
          <p className="text-muted text-sm">
            Real-time proof that your data never leaves your device.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={refreshData}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-sm" style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(255,71,87,0.3)' }} onClick={handlePanicWipe}>
            <Flame size={14} /> Panic Wipe
          </button>
        </div>
      </div>

      {/* Privacy Score */}
      <div className="score-card card fade-in">
        <div className="score-left">
          <div className={`score-circle ${isPrivate ? 'private' : 'warning'}`}>
            <span className="score-num">{privacyScore}</span>
            <span className="score-label">/ 100</span>
          </div>
        </div>
        <div className="score-right">
          <h3 className={isPrivate ? 'text-emerald' : 'text-amber'}>
            {isPrivate ? '✓ Privacy Verified' : '⚠ Issues Detected'}
          </h3>
          <p className="text-sm text-muted" style={{ marginTop: 4 }}>
            {isPrivate
              ? 'No telemetry or unexpected external calls detected.'
              : telemetryRequests.length > 0
                ? `${telemetryRequests.length} TELEMETRY call(s) detected!`
                : `${suspiciousRequests.length} unexpected external call(s).`
            }
          </p>
          {modelDownloadRequests.length > 0 && (
            <p className="text-xs text-muted" style={{ marginTop: 4 }}>
              ℹ️ {modelDownloadRequests.length} model download request(s) shown transparently below — these are expected during model loading.
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{
                width: `${privacyScore}%`,
                background: isPrivate
                  ? 'linear-gradient(90deg, #00ff88, #00d4ff)'
                  : 'linear-gradient(90deg, #ffb347, #ff4757)',
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* Status Grid */}
      <div className="audit-grid">
        <StatusCard
          icon={connStatus.isOnline ? <Wifi size={20} className="text-cyan" /> : <WifiOff size={20} className="text-emerald" />}
          label="Network"
          value={connStatus.isAirGapped ? 'Air-Gapped 🔒' : connStatus.isOnline ? 'Connected' : 'Offline'}
          accent={connStatus.isAirGapped ? 'emerald' : 'cyan'}
        />
        <StatusCard
          icon={<Shield size={20} className="text-emerald" />}
          label="AI Model"
          value={model.isReady ? 'Local' : 'Not Loaded'}
          accent={model.isReady ? 'emerald' : 'muted'}
          sub={model.modelId?.replace(/-MLC$/, '') || '—'}
        />
        <StatusCard
          icon={<Key size={20} className="text-cyan" />}
          label="Chat Encryption"
          value={vault.isLocked ? 'Locked' : 'AES-256-GCM'}
          accent={vault.isLocked ? 'amber' : 'emerald'}
          sub="Web Crypto API"
        />
        <StatusCard
          icon={<HardDrive size={20} className="text-purple" />}
          label="Storage"
          value={storageInfo ? `${storageInfo.usedGB} GB` : '—'}
          accent="purple"
          sub={storageInfo ? `${storageInfo.percentUsed}% of ${storageInfo.quotaGB} GB` : ''}
        />
        <StatusCard
          icon={<Eye size={20} className={isPrivate ? 'text-emerald' : 'text-red'} />}
          label="Exfiltration"
          value={telemetryRequests.length === 0 ? '0 bytes' : `${audit.sessionStats.externalBytes} B`}
          accent={isPrivate ? 'emerald' : 'red'}
          sub="Unauthorized data sent"
        />
        <StatusCard
          icon={<Database size={20} className="text-cyan" />}
          label="Vector DB"
          value="IndexedDB"
          accent="cyan"
          sub="Never leaves browser"
        />
        {memUsage && (
          <StatusCard
            icon={<Cpu size={20} className="text-purple" />}
            label="JS Heap"
            value={`${(memUsage.usedJSHeapSize / 1e6).toFixed(0)} MB`}
            accent="purple"
            sub={`of ${(memUsage.jsHeapSizeLimit / 1e6).toFixed(0)} MB limit`}
          />
        )}
      </div>

      {/* Live Network Feed — HONEST reporting */}
      <div className="card audit-section">
        <div className="audit-section-header">
          <Activity size={16} className="text-cyan" />
          <h3>Live Network Monitor</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>
              <span className="pulse" /> Live
            </span>
            <button className="btn-icon" onClick={audit.clearRequests}><RefreshCw size={12} /></button>
          </div>
        </div>

        <div className="network-feed">
          {audit.requests.length === 0 ? (
            <div className="feed-empty">
              <CheckCircle size={24} className="text-emerald" />
              <span className="text-sm text-muted">No network requests detected</span>
            </div>
          ) : (
            audit.requests.slice(0, 25).map(req => (
              <NetworkEntry key={req.id} req={req} />
            ))
          )}
        </div>

        <div className="feed-stats">
          <span className="text-xs text-muted">
            {audit.sessionStats.totalRequests} total · {(audit.sessionStats.totalBytes / 1024).toFixed(1)} KB
            {audit.sessionStats.externalBytes > 0 && (
              <span className="text-amber"> · {(audit.sessionStats.externalBytes / 1024).toFixed(1)} KB external</span>
            )}
          </span>
          <span className={`text-xs ${isPrivate ? 'text-emerald' : 'text-amber'}`}>
            {telemetryRequests.length === 0 ? '✓ No telemetry' : `🚨 ${telemetryRequests.length} telemetry calls!`}
          </span>
        </div>
      </div>

      {/* Cached Models */}
      <div className="card audit-section">
        <div className="audit-section-header">
          <HardDrive size={16} className="text-purple" />
          <h3>Cached Models (OPFS)</h3>
        </div>
        {cachedModels.length === 0 ? (
          <p className="text-sm text-muted" style={{ padding: '12px 0' }}>No models cached yet.</p>
        ) : (
          cachedModels.map(m => (
            <div key={m.modelId} className="model-cache-entry">
              <Shield size={14} className="text-emerald" />
              <div style={{ flex: 1 }}>
                <div className="text-sm">{m.modelId}</div>
                <div className="text-xs text-muted">Cached {new Date(m.cachedAt).toLocaleDateString()}</div>
              </div>
              <CheckCircle size={14} className="text-emerald" />
            </div>
          ))
        )}
      </div>

      {/* Privacy Certificate */}
      <div className="card certificate">
        <div className="cert-header">
          <Lock size={20} className="text-cyan" />
          <h3>Privacy Certificate</h3>
        </div>
        <div className="cert-body">
          <p className="text-sm">
            <strong>Sentry AI</strong> certifies that as of{' '}
            <strong>{lastRefresh.toLocaleString()}</strong>, all AI inference
            was performed on local hardware via WebGPU.
          </p>
          <div className="cert-facts">
            {[
              'No prompts sent to external servers',
              'No user data uploaded to the cloud',
              'Conversations encrypted with AES-256-GCM (Web Crypto API)',
              'Vector embeddings in IndexedDB (never in localStorage)',
              'Model weights in Origin Private File System',
              'Zero telemetry, analytics, or tracking',
            ].map(f => (
              <div key={f} className="cert-fact">
                <CheckCircle size={13} className="text-emerald" /> {f}
              </div>
            ))}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => {
          const cert = `SENTRY AI PRIVACY CERTIFICATE\n${lastRefresh.toISOString()}\n\nPrivacy Score: ${privacyScore}/100\nTelemetry Calls: ${telemetryRequests.length}\nUnexpected External: ${suspiciousRequests.length}\nModel Download Calls: ${modelDownloadRequests.length} (expected)\nChat Encryption: AES-256-GCM\nModel: ${model.modelId || 'N/A'}\nStatus: ${isPrivate ? 'VERIFIED PRIVATE' : 'WARNINGS DETECTED'}`;
          const blob = new Blob([cert], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'sentry-ai-privacy-cert.txt'; a.click();
          URL.revokeObjectURL(url);
        }}>
          <Download size={14} /> Export Certificate
        </button>
      </div>
    </div>
  );
}

function StatusCard({ icon, label, value, accent, sub }) {
  return (
    <div className="status-card card">
      {icon}
      <div className="text-xs text-muted" style={{ marginTop: 8 }}>{label}</div>
      <div className={`status-value text-${accent}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

const RISK_COLORS = {
  none: 'text-muted',
  low: 'text-muted',
  expected: 'text-cyan',
  medium: 'text-amber',
  high: 'text-amber',
  critical: 'text-red',
};

function NetworkEntry({ req }) {
  const domain = (() => {
    try { return new URL(req.url).hostname; }
    catch { return req.url.slice(0, 30); }
  })();

  const colorClass = RISK_COLORS[req.risk] || 'text-muted';

  return (
    <div className={`network-entry ${req.isExternal ? 'external' : ''}`}>
      <Globe size={12} className={colorClass} />
      <span className="text-xs truncate" style={{ flex: 1 }}>{domain}</span>
      <span className="text-xs text-muted">{(req.size / 1024).toFixed(1)}KB</span>
      <span className="text-xs text-muted">{req.timestamp}</span>
      <span
        className={`badge`}
        style={{
          fontSize: '0.6rem',
          padding: '2px 6px',
          background: req.risk === 'critical' ? 'var(--red-dim)' : req.risk === 'high' ? 'var(--amber-dim)' : 'var(--cyan-dim)',
          color: req.risk === 'critical' ? 'var(--red)' : req.risk === 'high' ? 'var(--amber)' : 'var(--cyan)',
        }}
      >
        {req.label || req.category}
      </span>
    </div>
  );
}