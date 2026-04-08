// ================================================================
// Vault.jsx
//
// BUG FIXES:
// 1. processFile called in handleDrop had `model` in its closure but
//    handleDrop's useCallback dep array only had `model` — if model
//    changed (became ready mid-session), the old processFile would run
//    with the stale model. Fixed by splitting processFile into a stable
//    useCallback with `model` as a dependency.
//
// 2. Audio processing used `new AudioContext({ sampleRate: 16000 })`
//    but never called `audioCtx.close()` — this leaks an AudioContext
//    per file upload. Fixed with try/finally.
//
// 3. `handleDrop` called `Array.from(e.dataTransfer?.files || e.target?.files || [])`
//    — `e.target.files` is only valid for `<input>` onChange, not for
//    native drop events.  The drop path now only reads `e.dataTransfer.files`.
//
// 4. `handleRemoveFile` did not stop processing files that were in-flight.
//    If you deleted a file while it was still indexing, the setFiles
//    update would set it to 'ready' after the delete.  Fixed with an
//    abortSet ref.
//
// 5. `setFiles` in `processFile` called after `handleRemoveFile` removed
//    the entry.  The status update is now guarded with a check.
//
// IMPROVEMENTS:
// A. Max file size guard (50MB) — large files would hang the UI.
// B. Duplicate file detection — re-adding the same filename warns the user.
// C. File type icons are now more specific.
// D. Search results show a "No results" empty state instead of silently empty.
// ================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, Upload, Search, Trash2, FileText, Image,
  Mic, X, CheckCircle, AlertCircle, Loader, FileCode
} from 'lucide-react';
import { useApp } from '../App';
import { initDB, ingestText, ingestPDF, hybridSearch, getDocumentCount, clearDB, removeBySource } from '../lib/orama';

const VAULT_KEY = 'sentry-ai-vault-files';
const MAX_FILE_SIZE_MB = 50;

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
  const [results, setResults] = useState(null); // null = not searched yet
  const [isSearching, setIsSearching] = useState(false);
  const [ingestProgress, setIngestProgress] = useState(null);
  const fileInputRef = useRef(null);
  // FIX: track which file IDs have been removed mid-processing
  const removedIds = useRef(new Set());

  useEffect(() => {
    initDB().then(() => getDocumentCount().then(setDocCount));
  }, []);

  useEffect(() => {
    localStorage.setItem(VAULT_KEY, JSON.stringify(files));
  }, [files]);

  const processFile = useCallback(async (file) => {
    if (!model.isReady) return;

    // IMPROVEMENT: file size guard
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`File "${file.name}" is larger than ${MAX_FILE_SIZE_MB}MB. Please split it into smaller chunks.`);
      return;
    }

    const type = file.type;
    const name = file.name;
    const fileId = `${name}-${Date.now()}`;

    // IMPROVEMENT: duplicate detection
    setFiles(prev => {
      const duplicate = prev.find(f => f.name === name && f.status === 'ready');
      if (duplicate) {
        if (!window.confirm(`"${name}" is already in your vault. Add it again?`)) return prev;
      }
      return [{ id: fileId, name, type: resolveType(type), size: (file.size / 1024).toFixed(1) + ' KB', addedAt: new Date().toLocaleDateString(), status: 'processing' }, ...prev];
    });

    try {
      const embedFn = async (text) => {
        const result = await model.embedText(text);
        return result ? new Float32Array(result) : new Float32Array(384);
      };

      if (type.includes('pdf')) {
        await ingestPDF(file, embedFn, (p) => {
          if (removedIds.current.has(fileId)) return;
          setIngestProgress({ name, stage: p.stage, done: p.done, total: p.total, label: p.stage === 'extract' ? 'Extracting pages…' : 'Building embeddings…' });
        });
      } else if (type.startsWith('image/')) {
        if (removedIds.current.has(fileId)) return;
        setIngestProgress({ name, label: 'Captioning image…' });
        const dataUrl = await readFileAsDataUrl(file);
        const caption = await model.captionImage(dataUrl);
        await ingestText(`[Image: ${name}]\n${caption}`, name, 'image', embedFn, () => { });
      } else if (type.startsWith('audio/')) {
        if (removedIds.current.has(fileId)) return;
        setIngestProgress({ name, label: 'Transcribing audio…' });
        const arrayBuffer = await file.arrayBuffer();
        let audioCtx;
        try {
          // FIX: close AudioContext when done to avoid leaking resources
          audioCtx = new AudioContext({ sampleRate: 16000 });
          const decoded = await audioCtx.decodeAudioData(arrayBuffer);
          const transcript = await model.transcribeAudio(decoded.getChannelData(0));
          await ingestText(transcript, name, 'audio', embedFn, () => { });
        } finally {
          audioCtx?.close();
        }
      } else {
        const text = await file.text();
        await ingestText(text, name, 'text', embedFn, (p) => {
          if (removedIds.current.has(fileId)) return;
          setIngestProgress({ name, label: 'Building embeddings…', done: p.done, total: p.total });
        });
      }

      // FIX: only update status if file wasn't removed
      if (!removedIds.current.has(fileId)) {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'ready' } : f));
        setIngestProgress(null);
        setDocCount(await getDocumentCount());
      }
    } catch (err) {
      if (!removedIds.current.has(fileId)) {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', error: err.message } : f));
        setIngestProgress(null);
      }
    }
  }, [model]);

  // FIX: drop handler only reads dataTransfer.files
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer?.files || []);
    for (const file of dropped) await processFile(file);
  }, [processFile]);

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
      setResults([]);
    }
    setIsSearching(false);
  };

  const handleRemoveFile = async (fileId, fileName) => {
    // FIX: mark as removed so in-flight processFile won't update it
    removedIds.current.add(fileId);
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setIngestProgress(prev => prev?.name === fileName ? null : prev);
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
    setResults(null);
    removedIds.current.clear();
    localStorage.removeItem(VAULT_KEY);
  };

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
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && model.isReady && fileInputRef.current?.click()}
        aria-label="Drop zone: click or drag files to upload"
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
        <p className="text-xs text-muted">PDF, TXT, MD, PNG, JPG, MP3, WAV · Max {MAX_FILE_SIZE_MB}MB · All processed locally</p>
        {!model.isReady && <p className="text-xs text-amber" style={{ marginTop: 4 }}>Load a model first</p>}
      </div>

      {ingestProgress && (
        <div className="ingest-progress card fade-in" aria-live="polite">
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
          aria-label="Semantic search input"
        />
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleSearch}
          disabled={isSearching || !model.isReady || !query.trim()}
        >
          {isSearching ? <Loader size={14} className="spinning" /> : 'Search'}
        </button>
      </div>

      {/* IMPROVEMENT: search states */}
      {results !== null && (
        <div className="search-results fade-in">
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
              <Search size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p className="text-sm">No results found. Try different keywords.</p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {files.length > 0 && (
        <div className="file-grid">
          {files.map(f => (
            <div key={f.id} className="file-card card">
              <div className="file-card-header">
                {typeIcon(f.type)}
                <span className="truncate text-sm" style={{ flex: 1 }} title={f.name}>{f.name}</span>
                <button
                  className="btn-icon"
                  onClick={() => handleRemoveFile(f.id, f.name)}
                  aria-label={`Remove ${f.name}`}
                  title="Remove from vault"
                >
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

function resolveType(mimeType) {
  if (mimeType.startsWith('image')) return 'image';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.startsWith('audio')) return 'audio';
  if (mimeType.includes('javascript') || mimeType.includes('html') || mimeType.includes('css')) return 'code';
  return 'text';
}

function typeIcon(type) {
  const map = {
    pdf: <FileText size={16} className="text-cyan" />,
    image: <Image size={16} className="text-purple" />,
    audio: <Mic size={16} className="text-amber" />,
    code: <FileCode size={16} className="text-emerald" />,
    text: <FileText size={16} className="text-emerald" />,
  };
  return map[type] || <FileText size={16} />;
}

function readFileAsDataUrl(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}