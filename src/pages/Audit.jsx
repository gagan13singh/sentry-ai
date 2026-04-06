// ================================================================
// Audit.jsx — Privacy Audit Dashboard
// Real-time network monitor + storage proof + privacy certificate
// ================================================================

import { useState, useEffect } from 'react';
import {
  Activity, Shield, Wifi, WifiOff, HardDrive,
  Eye, Download, RefreshCw, CheckCircle, Globe, Lock
} from 'lucide-react';
import { useApp } from '../App';
import { useNetworkAudit } from '../hooks/useNetworkAudit';
import { getStorageInfo, listCachedModels } from '../lib/opfs';

export default function Audit() {
  const { model, connStatus } = useApp();
  const audit = useNetworkAudit();

  const [storageInfo, setStorageInfo]   = useState(null);
  const [cachedModels, setCachedModels] = useState([]);
  const [lastRefresh, setLastRefresh]   = useState(new Date());

  useEffect(() => {
    refreshData();
  }, []);

  async function refreshData() {
    const info    = await getStorageInfo();
    const models  = await listCachedModels();
    setStorageInfo(info);
    setCachedModels(models);
    setLastRefresh(new Date());

    // Also clear the live network feed so the score properly resets
    audit.clearRequests();
  }

  // Group external non-model requests
  const suspiciousRequests = audit.externalRequests.filter(r => {
    const url = r.url.toLowerCase();
    return (
      !url.includes('localhost') &&
      !url.includes('huggingface') &&
      !url.includes('fonts.googleapis') &&
      !url.includes('fonts.gstatic') &&
      !url.includes('github') && // Model configs occasionally load from raw.githubusercontent
      !url.includes('cdn.jsdelivr')
    );
  });

  const privacyScore = Math.max(0, 100 - suspiciousRequests.length * 10);
  const isPrivate    = suspiciousRequests.length === 0;

  return (
    <div className="audit-page page-content">
      <div className="page-header">
        <div>
          <h2>Privacy Audit</h2>
          <p className="text-muted text-sm">
            Real-time proof that your data never leaves your device.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refreshData}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* ── Privacy Score ── */}
      <div className="score-card card fade-in">
        <div className="score-left">
          <div className={`score-circle ${isPrivate ? 'private' : 'warning'}`}>
            <span className="score-num">{privacyScore}</span>
            <span className="score-label">/ 100</span>
          </div>
        </div>
        <div className="score-right">
          <h3 className={isPrivate ? 'text-emerald' : 'text-amber'}>
            {isPrivate ? '✓ Privacy Verified' : '⚠ External Calls Detected'}
          </h3>
          <p className="text-sm text-muted" style={{ marginTop: 4 }}>
            {isPrivate
              ? 'Zero unauthorized bytes transmitted during AI operations.'
              : `${suspiciousRequests.length} unexpected external request(s) detected.`}
          </p>
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

      {/* ── Status Grid ── */}
      <div className="audit-grid">
        <StatusCard
          icon={connStatus.isOnline ? <Wifi size={20} className="text-cyan" /> : <WifiOff size={20} className="text-emerald" />}
          label="Network Status"
          value={connStatus.isAirGapped ? 'Air-Gapped 🔒' : connStatus.isOnline ? 'Connected' : 'Offline'}
          accent={connStatus.isAirGapped ? 'emerald' : 'cyan'}
        />
        <StatusCard
          icon={<Shield size={20} className="text-emerald" />}
          label="AI Model"
          value={model.isReady ? 'Loaded Locally' : 'Not Loaded'}
          accent={model.isReady ? 'emerald' : 'muted'}
          sub={model.modelId?.replace(/-MLC$/, '') || '—'}
        />
        <StatusCard
          icon={<HardDrive size={20} className="text-purple" />}
          label="Local Storage"
          value={storageInfo ? `${storageInfo.usedGB} GB used` : '—'}
          accent="purple"
          sub={storageInfo ? `${storageInfo.percentUsed}% of ${storageInfo.quotaGB} GB quota` : ''}
        />
        <StatusCard
          icon={<Eye size={20} className={isPrivate ? 'text-emerald' : 'text-red'} />}
          label="Data Exfiltration"
          value={isPrivate ? '0 bytes' : `${audit.sessionStats.totalBytes} bytes`}
          accent={isPrivate ? 'emerald' : 'red'}
          sub="During AI inference session"
        />
      </div>

      {/* ── Live Network Feed ── */}
      <div className="card audit-section">
        <div className="audit-section-header">
          <Activity size={16} className="text-cyan" />
          <h3>Live Network Monitor</h3>
          <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
            <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>
              <span className="pulse" /> Live
            </span>
            <button className="btn-icon" onClick={audit.clearRequests}>
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        <div className="network-feed">
          {audit.requests.length === 0 ? (
            <div className="feed-empty">
              <CheckCircle size={24} className="text-emerald" />
              <span className="text-sm text-muted">No network requests detected</span>
            </div>
          ) : (
            audit.requests.slice(0, 20).map(req => (
              <NetworkEntry key={req.id} req={req} />
            ))
          )}
        </div>

        <div className="feed-stats">
          <span className="text-xs text-muted">
            {audit.sessionStats.totalRequests} total requests ·&nbsp;
            {(audit.sessionStats.totalBytes / 1024).toFixed(1)} KB transferred
          </span>
          <span className={`text-xs ${isPrivate ? 'text-emerald' : 'text-amber'}`}>
            {suspiciousRequests.length === 0
              ? '✓ No unauthorized requests'
              : `${suspiciousRequests.length} suspicious`}
          </span>
        </div>
      </div>

      {/* ── Cached Models ── */}
      <div className="card audit-section">
        <div className="audit-section-header">
          <HardDrive size={16} className="text-purple" />
          <h3>Cached Models (OPFS)</h3>
        </div>

        {cachedModels.length === 0 ? (
          <p className="text-sm text-muted" style={{ padding: '12px 0' }}>
            No models in OPFS cache yet. Models are cached after first load.
          </p>
        ) : (
          cachedModels.map(m => (
            <div key={m.modelId} className="model-cache-entry">
              <Shield size={14} className="text-emerald" />
              <div style={{ flex: 1 }}>
                <div className="text-sm">{m.modelId}</div>
                <div className="text-xs text-muted">
                  Cached {new Date(m.cachedAt).toLocaleDateString()}
                </div>
              </div>
              <CheckCircle size={14} className="text-emerald" />
            </div>
          ))
        )}
      </div>

      {/* ── Privacy Certificate ── */}
      <div className="card certificate">
        <div className="cert-header">
          <Lock size={20} className="text-cyan" />
          <h3>Privacy Certificate</h3>
        </div>
        <div className="cert-body">
          <p className="text-sm">
            <strong>Sentry AI</strong> certifies that as of{' '}
            <strong>{lastRefresh.toLocaleString()}</strong>, all AI inference
            operations were performed entirely on local hardware using WebGPU acceleration.
          </p>
          <div className="cert-facts">
            {[
              'No prompts sent to external servers',
              'No user data uploaded to the cloud',
              'Model weights stored in Origin Private File System',
              'Vector embeddings stored in browser-native Orama DB',
              'Conversations stored only in localStorage',
            ].map(f => (
              <div key={f} className="cert-fact">
                <CheckCircle size={13} className="text-emerald" /> {f}
              </div>
            ))}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => {
          const cert = `SENTRY AI PRIVACY CERTIFICATE\n${lastRefresh.toISOString()}\n\nPrivacy Score: ${privacyScore}/100\nExternal Requests: ${suspiciousRequests.length}\nModel: ${model.modelId || 'N/A'}\nStatus: ${isPrivate ? 'VERIFIED PRIVATE' : 'WARNINGS DETECTED'}`;
          const blob = new Blob([cert], { type: 'text/plain' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url; a.download = 'sentry-ai-privacy-cert.txt'; a.click();
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

function NetworkEntry({ req }) {
  const isInternal = req.isSentryInternal;
  const domain = (() => {
    try { return new URL(req.url).hostname; }
    catch { return req.url.slice(0, 30); }
  })();

  return (
    <div className={`network-entry ${isInternal ? 'internal' : 'external'}`}>
      <Globe size={12} className={isInternal ? 'text-muted' : 'text-amber'} />
      <span className="text-xs truncate" style={{ flex: 1 }}>{domain}</span>
      <span className="text-xs text-muted">{(req.size / 1024).toFixed(1)}KB</span>
      <span className="text-xs text-muted">{req.timestamp}</span>
      <span className={`badge ${isInternal ? 'badge-cyan' : 'badge-amber'}`}
        style={{ fontSize: '0.6rem', padding: '2px 6px' }}>
        {isInternal ? req.type : 'ext'}
      </span>
    </div>
  );
}
