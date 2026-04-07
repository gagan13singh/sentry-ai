// ================================================================
// Vault.jsx — Knowledge Vault
// FIXED: removeBySource actually called when deleting files
// FIXED: ingest progress shown for all stages (extract + embed)
// ================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, Upload, Search, Trash2, FileText, Image,
  Mic, X, CheckCircle, AlertCircle, Loader
} from 'lucide-react';
import { useApp } from '../App';
import { initDB, ingestText, ingestPDF, hybridSearch, getDocumentCount, clearDB, removeBySource } from '../lib/orama';

const VAULT_KEY = 'sentry-ai-vault-files';

function loadVaultFiles() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY) || '[]'); }
  catch { return []; }
}

export default function Vault() {
  const { model } = useApp();
  const [files, setFiles] = useState(loadVaultFiles);
  const [docCount, setDocCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [ingestProgress, setIngestProgress] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    initDB().then(() => getDocumentCount().then(setDocCount));
  }, []);

  useEffect(() => {
    localStorage.setItem(VAULT_KEY, JSON.stringify(files));
  }, [files]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer?.files || e.target?.files || []);
    for (const file of dropped) await processFile(file);
  }, [model]);

  const processFile = async (file) => {
    if (!model.isReady) return;
    const type = file.type;
    const name = file.name;

    const fileEntry = {
      id: `${name}-${Date.now()}`,
      name,
      type: type.startsWith('image') ? 'image' : type.includes('pdf') ? 'pdf' : type.startsWith('audio') ? 'audio' : 'text',
      size: (file.size / 1024).toFixed(1) + ' KB',
      addedAt: new Date().toLocaleDateString(),
      status: 'processing',
    };
    setFiles(prev => [fileEntry, ...prev]);

    try {
      const embedFn = async (text) => {
        const result = await model.embedText(text);
        return result ? new Float32Array(result) : new Float32Array(384);
      };

      if (type.includes('pdf')) {
        await ingestPDF(file, embedFn, (p) => {
          setIngestProgress({
            name,
            stage: p.stage,
            done: p.done,
            total: p.total,
            label: p.stage === 'extract' ? 'Extracting pages…' : 'Building embeddings…',
          });
        });
      } else if (type.startsWith('image/')) {
        setIngestProgress({ name, label: 'Captioning image…' });
        const dataUrl = await readFileAsDataUrl(file);
        const caption = await model.captionImage(dataUrl);
        await ingestText(`[Image: ${name}]\n${caption}`, name, 'image', embedFn, () => { });
      } else if (type.startsWith('audio/')) {
        setIngestProgress({ name, label: 'Transcribing audio…' });
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const transcript = await model.transcribeAudio(decoded.getChannelData(0));
        await ingestText(transcript, name, 'audio', embedFn, () => { });
      } else {
        const text = await file.text();
        await ingestText(text, name, 'text', embedFn, (p) => {
          setIngestProgress({ name, label: 'Building embeddings…', done: p.done, total: p.total });
        });
      }

      setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: 'ready' } : f));
      setIngestProgress(null);
      setDocCount(await getDocumentCount());
    } catch (err) {
      setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: 'error', error: err.message } : f));
      setIngestProgress(null);
    }
  };

  const handleSearch = async () => {
    if (!query.trim() || !model.isReady) return;
    setIsSearching(true);
    setResults([]);
    try {
      const embedding = await model.embedText(query);
      const vec = embedding ? new Float32Array(embedding) : new Float32Array(384);
      const hits = await hybridSearch(query, vec, 8);
      setResults(hits);
    } catch (e) {
      console.error(e);
    }
    setIsSearching(false);
  };

  // FIXED: actually removes vectors from the DB
  const handleRemoveFile = async (fileId, fileName) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    try {
      await removeBySource(fileName);
      setDocCount(await getDocumentCount());
    } catch (e) {
      console.warn('removeBySource failed:', e);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Clear all vault data? This cannot be undone.')) return;
    await clearDB();
    setFiles([]);
    setDocCount(0);
    setResults([]);
    localStorage.removeItem(VAULT_KEY);
  };

  const typeIcon = (type) => ({
    pdf: <FileText size={16} className="text-cyan" />,
    image: <Image size={16} className="text-purple" />,
    audio: <Mic size={16} className="text-amber" />,
    text: <FileText size={16} className="text-emerald" />,
  }[type] || <FileText size={16} />);

  return (
    <div className="vault-page page-content">
      <div className="page-header">
        <div>
          <h2>Knowledge Vault</h2>
          <p className="text-muted text-sm">{docCount} chunks indexed · {files.length} files</p>
        </div>
        {files.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={handleClearAll}>
            <Trash2 size={14} /> Clear All
          </button>
        )}
      </div>

      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${!model.isReady ? 'disabled' : ''}`}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => model.isReady && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a"
          onChange={e => Array.from(e.target.files).forEach(processFile)}
        />
        <Upload size={32} className={isDragging ? 'text-cyan' : 'text-muted'} />
        <p className="text-sm" style={{ marginTop: 8 }}>
          {isDragging ? 'Drop to ingest' : 'Drop files or click to upload'}
        </p>
        <p className="text-xs text-muted">PDF, TXT, MD, PNG, JPG, MP3, WAV · All processed locally</p>
        {!model.isReady && <p className="text-xs text-amber" style={{ marginTop: 4 }}>Load a model first</p>}
      </div>

      {ingestProgress && (
        <div className="ingest-progress card fade-in">
          <div className="flex items-center gap-3">
            <div className="spinner" />
            <div style={{ flex: 1 }}>
              <div className="flex justify-between text-sm">
                <span>{ingestProgress.label || 'Processing…'} {ingestProgress.name}</span>
                {ingestProgress.total && (
                  <span className="text-cyan mono">{ingestProgress.done}/{ingestProgress.total}</span>
                )}
              </div>
              {ingestProgress.total && (
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className="progress-bar-fill"
                    style={{ width: `${(ingestProgress.done / ingestProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="vault-search card">
        <Search size={16} className="text-muted" />
        <input
          className="vault-search-input"
          placeholder="Search your vault semantically…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{ background: 'none', border: 'none', flex: 1 }}
        />
        <button className="btn btn-secondary btn-sm" onClick={handleSearch} disabled={isSearching || !model.isReady}>
          {isSearching ? <Loader size={14} className="spinning" /> : 'Search'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="search-results fade-in">
          <h4 className="text-sm text-muted" style={{ marginBottom: 12 }}>
            {results.length} results found
          </h4>
          {results.map((r, i) => (
            <div key={r.id || i} className="result-card card">
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <span className="text-xs text-cyan mono">{r.source}</span>
                <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                  {(r.score * 100).toFixed(0)}% match
                </span>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {r.content.slice(0, 300)}{r.content.length > 300 ? '…' : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="file-grid">
          {files.map(f => (
            <div key={f.id} className="file-card card">
              <div className="file-card-header">
                {typeIcon(f.type)}
                <span className="truncate text-sm" style={{ flex: 1 }}>{f.name}</span>
                <button className="btn-icon" onClick={() => handleRemoveFile(f.id, f.name)}>
                  <X size={14} />
                </button>
              </div>
              <div className="file-card-meta">
                <span className="text-xs text-muted">{f.size}</span>
                <span className="text-xs text-muted">{f.addedAt}</span>
                {f.status === 'ready' && <CheckCircle size={12} className="text-emerald" />}
                {f.status === 'processing' && <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
                {f.status === 'error' && <AlertCircle size={12} className="text-red" title={f.error} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {files.length === 0 && (
        <div className="vault-empty">
          <FolderOpen size={40} className="text-muted" />
          <p className="text-muted">Your vault is empty. Drop some files above.</p>
        </div>
      )}
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}