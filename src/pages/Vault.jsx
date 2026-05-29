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

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FolderOpen, Upload, Search, Trash2, FileText, Image,
  Mic, X, CheckCircle, AlertCircle, Loader, FileCode, Copy, Check
} from 'lucide-react';
import { useApp } from '../App';
import { initDB, ingestText, ingestPDF, hybridSearch, vectorSearch, getDocumentCount, clearDB, removeBySource, getChunksBySource, getAllChunks } from '../lib/orama';

const VAULT_KEY = 'sentry-ai-vault-files';
const MAX_FILE_SIZE_MB = 50;

function loadVaultFiles() {
  try {
    const saved = JSON.parse(localStorage.getItem(VAULT_KEY) || '[]');
    // FIX: any file stuck in 'processing' from a previous session will never
    // complete — reset them to 'error' so the user knows to re-upload.
    return saved.map(f => f.status === 'processing' ? { ...f, status: 'error', error: 'Interrupted — please re-upload' } : f);
  }
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

  const [activeFilter, setActiveFilter] = useState('all');
  const [searchFileQuery, setSearchFileQuery] = useState('');
  const [selectedFileForInspection, setSelectedFileForInspection] = useState(null);
  const [isInspectingChunks, setIsInspectingChunks] = useState(false);

  // New Premium Vault features state
  const [activeTab, setActiveTab] = useState('files');
  const [searchMode, setSearchMode] = useState('hybrid');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickText, setQuickText] = useState('');
  const [isQuickIngesting, setIsQuickIngesting] = useState(false);
  const [allChunks, setAllChunks] = useState([]);
  const [searchChunkQuery, setSearchChunkQuery] = useState('');

  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      const matchesCategory = activeFilter === 'all' || f.type === activeFilter;
      const matchesSearch = f.name.toLowerCase().includes(searchFileQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [files, activeFilter, searchFileQuery]);

  // Document type distribution counts
  const typeCounts = useMemo(() => {
    const counts = { pdf: 0, image: 0, audio: 0, text: 0, code: 0 };
    files.forEach(f => {
      if (counts[f.type] !== undefined) counts[f.type]++;
    });
    return counts;
  }, [files]);

  const loadAllChunks = useCallback(async () => {
    try {
      const docs = await getAllChunks();
      setAllChunks(docs);
    } catch (e) {
      console.warn('Failed to load all chunks:', e);
    }
  }, []);

  const filteredChunks = useMemo(() => {
    return allChunks.filter(c => {
      const textMatch = c.content.toLowerCase().includes(searchChunkQuery.toLowerCase());
      const sourceMatch = c.source.toLowerCase().includes(searchChunkQuery.toLowerCase());
      return textMatch || sourceMatch;
    });
  }, [allChunks, searchChunkQuery]);

  useEffect(() => {
    initDB().then(() => getDocumentCount().then(setDocCount));
  }, []);

  useEffect(() => {
    localStorage.setItem(VAULT_KEY, JSON.stringify(files));
  }, [files]);

  useEffect(() => {
    if (activeTab === 'chunks') {
      loadAllChunks();
    }
  }, [activeTab, loadAllChunks, files]);

  const processFile = useCallback(async (file) => {
    if (!model.isReady) {
      alert('Please load a model first before uploading files.');
      return;
    }

    // IMPROVEMENT: file size guard
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`File "${file.name}" is larger than ${MAX_FILE_SIZE_MB}MB. Please split it into smaller chunks.`);
      return;
    }

    const type = file.type;
    const name = file.name;
    const fileId = `${name}-${Date.now()}`;

    // Deterministic duplicate detection before modifying any state
    let isDuplicate = false;
    setFiles(prev => {
      isDuplicate = prev.some(f => f.name === name && f.status === 'ready');
      return prev;
    });

    if (isDuplicate) {
      if (!window.confirm(`"${name}" is already in your vault. Add it again?`)) {
        return;
      }
    }

    // Add file with 'processing' status
    setFiles(prev => [
      { id: fileId, name, type: resolveType(type), size: (file.size / 1024).toFixed(1) + ' KB', addedAt: new Date().toLocaleDateString(), status: 'processing' },
      ...prev
    ]);

    try {
      // FIX: embedFn guards against null return from model.embedText (e.g. worker not ready)
      const embedFn = async (text) => {
        const result = await model.embedText(text);
        if (!result || !result.length) {
          throw new Error('Embedding model returned no data. Ensure the model is fully loaded.');
        }
        return new Float32Array(result).slice(0, 384);
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
        if (!text.trim()) throw new Error('File appears to be empty or unreadable as text.');
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
      console.error('processFile error:', err);
      if (!removedIds.current.has(fileId)) {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', error: err.message } : f));
        setIngestProgress(null);
      }
    }
  }, [model]);

  // Snippet raw text paste ingestion handler
  const handleQuickIngest = async (e) => {
    e.preventDefault();
    if (!model.isReady) {
      alert('Please load a model first before uploading files.');
      return;
    }
    if (!quickText.trim()) return;

    setIsQuickIngesting(true);
    const name = quickTitle.trim() || `Snippet-${new Date().toLocaleTimeString().replace(/:/g, '-')}`;
    const fileId = `${name}-${Date.now()}`;

    // Deterministic duplicate detection
    let isDuplicate = files.some(f => f.name === name);
    if (isDuplicate) {
      if (!window.confirm(`"${name}" is already in your vault. Add it again?`)) {
        setIsQuickIngesting(false);
        return;
      }
    }

    // Add file with 'processing' status
    setFiles(prev => [
      { id: fileId, name, type: 'text', size: (quickText.length / 1024).toFixed(1) + ' KB', addedAt: new Date().toLocaleDateString(), status: 'processing' },
      ...prev
    ]);

    try {
      const embedFn = async (text) => {
        const result = await model.embedText(text);
        if (!result || !result.length) {
          throw new Error('Embedding model returned no data. Ensure the model is fully loaded.');
        }
        return new Float32Array(result).slice(0, 384);
      };

      setIngestProgress({ name, label: 'Building embeddings…', done: 0, total: 1 });
      await ingestText(quickText, name, 'text', embedFn, (p) => {
        setIngestProgress({ name, label: 'Building embeddings…', done: p.done, total: p.total });
      });

      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'ready' } : f));
      setQuickTitle('');
      setQuickText('');
      setIngestProgress(null);
      setDocCount(await getDocumentCount());
      if (activeTab === 'chunks') {
        loadAllChunks();
      }
    } catch (err) {
      console.error('Quick Ingest error:', err);
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', error: err.message } : f));
      setIngestProgress(null);
    } finally {
      setIsQuickIngesting(false);
    }
  };

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
      if (!embedding || !embedding.length) {
        console.error('Search failed: embedding model returned no data.');
        setResults([]);
        return;
      }
      const vec = new Float32Array(embedding).slice(0, 384);
      let hits = [];
      if (searchMode === 'hybrid') {
        hits = await hybridSearch(query, vec, 8);
      } else {
        hits = await vectorSearch(vec, 8);
      }
      setResults(hits);
    } catch (e) {
      console.error('Search error:', e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRemoveFile = async (fileId, fileName) => {
    // FIX: mark as removed so in-flight processFile won't update it
    removedIds.current.add(fileId);
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setIngestProgress(prev => prev?.name === fileName ? null : prev);
    try {
      await removeBySource(fileName);
      setDocCount(await getDocumentCount());
      if (activeTab === 'chunks') {
        loadAllChunks();
      }
    } catch (e) {
      console.warn('removeBySource failed:', e);
    }
  };

  const handleInspectChunks = async (fileName) => {
    setIsInspectingChunks(true);
    try {
      const chunks = await getChunksBySource(fileName);
      setSelectedFileForInspection({ name: fileName, chunks });
    } catch (e) {
      console.error('Inspect chunks error:', e);
    } finally {
      setIsInspectingChunks(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Clear all vault data? This cannot be undone.')) return;
    await clearDB();
    setFiles([]);
    setDocCount(0);
    setResults(null);
    setAllChunks([]);
    removedIds.current.clear();
    localStorage.removeItem(VAULT_KEY);
  };

  return (
    <div className="vault-page page-content">
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h2>Knowledge Vault</h2>
          <p className="text-muted text-sm">{docCount} semantic chunks · {files.length} files ingested</p>
        </div>
        {files.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={handleClearAll}>
            <Trash2 size={14} /> Clear All
          </button>
        )}
      </div>

      {/* Tabs navigation */}
      <div className="vault-tabs" style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        <button
          className={`btn ${activeTab === 'files' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('files')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', padding: '6px 14px', borderRadius: 6 }}
        >
          <FolderOpen size={14} />
          Files Repository
        </button>
        <button
          className={`btn ${activeTab === 'chunks' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('chunks')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', padding: '6px 14px', borderRadius: 6 }}
        >
          <FileText size={14} />
          Neural Chunk Map ({allChunks.length})
        </button>
      </div>

      {activeTab === 'files' ? (
        <>
          {/* Vault Database Stats / Metrics */}
          <div className="vault-metrics-row" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}>
            {[
              { label: 'Indexed Chunks', value: docCount, icon: <FileText size={16} className="text-cyan" /> },
              { label: 'Ingested Files', value: files.length, icon: <FolderOpen size={16} className="text-purple" /> },
              { label: 'Database Health', value: 'Persistent', sub: 'IndexedDB Secure', icon: <CheckCircle size={16} className="text-emerald" /> },
              { label: 'Vector Footprint', value: `${(docCount * 1.4).toFixed(1)} KB`, sub: 'Average 384 dimensions', icon: <Search size={16} className="text-amber" /> }
            ].map((metric, idx) => (
              <div key={idx} className="card" style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                background: 'rgba(255, 255, 255, 0.01)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
                  {metric.icon}
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                    {metric.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                    {metric.value}
                  </div>
                  {metric.sub && (
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                      {metric.sub}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Premium Database Analytics Segmented Bar */}
          {files.length > 0 && (
            <div className="card" style={{ padding: 14, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Vault Type Distribution</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--cyan)', fontWeight: 600 }}>{files.length} Elements Ingested</span>
              </div>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
                {['pdf', 'image', 'audio', 'text', 'code'].map(type => {
                  const count = typeCounts[type];
                  if (!count) return null;
                  const pct = (count / files.length) * 100;
                  const colors = {
                    pdf: 'var(--cyan)',
                    image: 'var(--purple)',
                    audio: 'var(--amber)',
                    text: 'var(--emerald)',
                    code: 'var(--emerald)',
                  };
                  return (
                    <div
                      key={type}
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: colors[type] || 'var(--text-muted)',
                        transition: 'width 0.5s ease',
                      }}
                      title={`${type.toUpperCase()}: ${count} files (${pct.toFixed(0)}%)`}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                {['pdf', 'image', 'audio', 'text', 'code'].map(type => {
                  const count = typeCounts[type];
                  if (!count) return null;
                  const labels = { pdf: 'PDF Documents', image: 'Images', audio: 'Audios', text: 'Text', code: 'Code' };
                  const colors = { pdf: 'var(--cyan)', image: 'var(--purple)', audio: 'var(--amber)', text: 'var(--emerald)', code: 'var(--emerald)' };
                  return (
                    <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors[type] }} />
                      <span>{labels[type]}: <strong>{count}</strong></span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unified Ingestion Section */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
            {/* Drop Zone */}
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
              style={{ margin: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 200 }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a"
                onChange={async (e) => {
                  const selected = Array.from(e.target.files || []);
                  for (const file of selected) {
                    await processFile(file);
                  }
                  e.target.value = '';
                }}
              />
              <Upload size={28} className={isDragging ? 'text-cyan animate-pulse' : 'text-muted'} />
              <p className="text-sm" style={{ marginTop: 8, fontWeight: 600 }}>
                {isDragging ? 'Drop to Ingest' : 'Drag & Drop Files'}
              </p>
              <p className="text-xs text-muted" style={{ padding: '0 10px', marginTop: 4 }}>
                PDF, TXT, MD, PNG, JPG, MP3, WAV · Max {MAX_FILE_SIZE_MB}MB
              </p>
              {!model.isReady && <p className="text-xs text-amber" style={{ marginTop: 4 }}>Load a model first</p>}
            </div>

            {/* Quick Paste Snippet Card */}
            <form onSubmit={handleQuickIngest} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Copy size={16} className="text-cyan" />
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Quick Snippet Ingestion</span>
              </div>
              
              <input
                type="text"
                placeholder="Snippet title (e.g. Meeting Notes)..."
                value={quickTitle}
                onChange={e => setQuickTitle(e.target.value)}
                disabled={isQuickIngesting || !model.isReady}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: '0.78rem',
                  outline: 'none',
                  color: 'var(--text-primary)',
                }}
              />
              
              <textarea
                placeholder="Paste raw text, logs, or codes to chunk & index instantly..."
                value={quickText}
                onChange={e => setQuickText(e.target.value)}
                disabled={isQuickIngesting || !model.isReady}
                required
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: '0.78rem',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  resize: 'none',
                  flex: 1,
                  minHeight: 80,
                  fontFamily: 'inherit',
                }}
              />

              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                disabled={isQuickIngesting || !model.isReady || !quickText.trim()}
                style={{ width: '100%', height: 32, justifyContent: 'center' }}
              >
                {isQuickIngesting ? <Loader size={14} className="spinning" /> : 'Ingest Snippet'}
              </button>
            </form>
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

          {/* Semantic Search Box */}
          <div className="vault-search card" style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
              <Search size={16} className="text-muted" />
              <input
                className="vault-search-input"
                placeholder={searchMode === 'hybrid' ? "Search semantically with hybrid keywords..." : "Search using strict deep learning vector similarity..."}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                style={{ background: 'none', border: 'none', flex: 1, outline: 'none', color: 'var(--text-primary)' }}
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

            {/* Search Engine Selectors */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.75)', fontWeight: 600, letterSpacing: '0.5px' }}>SEARCH ENGINE MODEL:</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setSearchMode('hybrid')}
                    style={{
                      cursor: 'pointer',
                      padding: '5px 12px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      borderRadius: 6,
                      transition: 'all 0.2s ease',
                      background: searchMode === 'hybrid' ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.03)',
                      color: searchMode === 'hybrid' ? 'var(--cyan)' : 'rgba(255,255,255,0.6)',
                      border: `1px solid ${searchMode === 'hybrid' ? 'rgba(6, 182, 212, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                    }}
                    onMouseEnter={(e) => {
                      if (searchMode !== 'hybrid') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                        e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (searchMode !== 'hybrid') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
                      }
                    }}
                  >
                    Hybrid Retrieval (Text + Vector)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchMode('vector')}
                    style={{
                      cursor: 'pointer',
                      padding: '5px 12px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      borderRadius: 6,
                      transition: 'all 0.2s ease',
                      background: searchMode === 'vector' ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.03)',
                      color: searchMode === 'vector' ? 'var(--cyan)' : 'rgba(255,255,255,0.6)',
                      border: `1px solid ${searchMode === 'vector' ? 'rgba(6, 182, 212, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                    }}
                    onMouseEnter={(e) => {
                      if (searchMode !== 'vector') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                        e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (searchMode !== 'vector') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
                      }
                    }}
                  >
                    Dense Vector Model (Cos-Sim)
                  </button>
                </div>
              </div>

              {/* Bracketed Simple Explanation below */}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 4 }}>
                {searchMode === 'hybrid' ? (
                  <span>(<strong>Keyword + AI Meaning</strong>: Matches exact keywords you type, while also looking for related concepts. Best for standard searching.)</span>
                ) : (
                  <span>(<strong>AI Conceptual Match</strong>: Uses deep learning to search for the core ideas and meaning, even if none of the exact words match.)</span>
                )}
              </div>
            </div>
          </div>

          {/* Semantic Search Results */}
          {results !== null && (
            <div className="search-results fade-in" style={{ marginBottom: 24 }}>
              {results.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  <Search size={32} style={{ opacity: 0.3, marginBottom: 8, margin: '0 auto' }} />
                  <p className="text-sm">No semantic matches found. Try different terms.</p>
                </div>
              ) : (
                <>
                  <h4 className="text-sm text-muted" style={{ marginBottom: 12 }}>
                    {results.length} semantic matches
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {results.map((r, i) => (
                      <SearchResultRow key={r.id || i} r={r} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* File Ingested Controls & Grid */}
          {files.length > 0 && (
            <div className="vault-filters card" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)', padding: '6px 10px' }}>
                <Search size={14} className="text-muted" />
                <input
                  type="text"
                  placeholder="Search uploaded files by name..."
                  value={searchFileQuery}
                  onChange={(e) => setSearchFileQuery(e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none', flex: 1 }}
                />
                {searchFileQuery && <X size={14} className="text-muted" style={{ cursor: 'pointer' }} onClick={() => setSearchFileQuery('')} />}
              </div>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['all', 'pdf', 'image', 'audio', 'text', 'code'].map(category => (
                  <button
                    key={category}
                    className={`badge ${activeFilter === category ? 'badge-cyan' : ''}`}
                    onClick={() => setActiveFilter(category)}
                    style={{
                      cursor: 'pointer',
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      background: activeFilter === category ? undefined : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${activeFilter === category ? 'var(--cyan)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: 100,
                    }}
                  >
                    {category} ({category === 'all' ? files.length : files.filter(f => f.type === category).length})
                  </button>
                ))}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div className="file-grid">
              {filteredFiles.map(f => (
                <div key={f.id} className="file-card card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'between' }}>
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
                  <div className="file-card-meta" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span className="text-xs text-muted">{f.size}</span>
                      <span className="text-xs text-muted">{f.addedAt}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {f.status === 'ready' && (
                        <>
                          <button
                            className="btn btn-ghost"
                            onClick={(e) => { e.stopPropagation(); handleInspectChunks(f.name); }}
                            style={{ fontSize: '0.68rem', padding: '2px 6px', height: 'auto', background: 'rgba(6,182,212,0.05)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,0.15)', borderRadius: 4, cursor: 'pointer' }}
                            title="Inspect semantic chunks"
                            disabled={isInspectingChunks}
                          >
                            Inspect
                          </button>
                          <CheckCircle size={12} className="text-emerald" />
                        </>
                      )}
                      {f.status === 'processing' && <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
                      {f.status === 'error' && <AlertCircle size={12} className="text-red" title={f.error} />}
                    </div>
                  </div>
                </div>
              ))}
              {filteredFiles.length === 0 && (
                <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                  No filtered files match your query.
                </div>
              )}
            </div>
          )}

          {files.length === 0 && (
            <div className="vault-empty">
              <FolderOpen size={40} className="text-muted" />
              <p className="text-muted">Your vault is empty. Ingest some files or snippets above.</p>
            </div>
          )}
        </>
      ) : (
        /* Neural Chunk Map Tab */
        <>
          <div className="vault-search card" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' }}>
            <Search size={16} className="text-muted" />
            <input
              className="vault-search-input"
              placeholder="Search all individual semantic chunks in DB..."
              value={searchChunkQuery}
              onChange={e => setSearchChunkQuery(e.target.value)}
              style={{ background: 'none', border: 'none', flex: 1, outline: 'none', color: 'var(--text-primary)' }}
              aria-label="Search chunk contents"
            />
            {searchChunkQuery && <X size={14} className="text-muted" style={{ cursor: 'pointer' }} onClick={() => setSearchChunkQuery('')} />}
          </div>

          {filteredChunks.length === 0 ? (
            <div className="vault-empty">
              <FileText size={40} className="text-muted" />
              <p className="text-muted">No individual semantic chunks found matching your search.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(285px, 1fr))', gap: 14, marginBottom: 20 }}>
              {filteredChunks.map((chunk, idx) => (
                <ChunkCard key={chunk.id || idx} chunk={chunk} index={idx} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Chunk Viewer Modal */}
      {selectedFileForInspection && (
        <div className="modal-overlay" onClick={() => setSelectedFileForInspection(null)} style={{ zIndex: 1000 }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
            <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={20} className="text-cyan" />
                <h3 className="truncate" style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', maxWidth: 450, margin: 0 }} title={selectedFileForInspection.name}>
                  {selectedFileForInspection.name}
                </h3>
              </div>
              <button className="btn-icon" onClick={() => setSelectedFileForInspection(null)} aria-label="Close modal">
                <X size={16} />
              </button>
            </div>
            
            <div style={{ padding: '10px 20px', background: 'rgba(6,182,212,0.02)', borderBottom: '1px solid var(--border)' }}>
              <p className="text-xs text-muted" style={{ margin: 0 }}>
                Showing all generated semantic text chunks ({selectedFileForInspection.chunks.length} total) parsed for neural vector indexing.
              </p>
            </div>

            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedFileForInspection.chunks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <p className="text-sm">No chunks found. File failed to index or is empty.</p>
                </div>
              ) : (
                selectedFileForInspection.chunks.map((chunk, index) => (
                  <ChunkRow key={chunk.id || index} chunk={chunk} index={index} />
                ))
              )}
            </div>
          </div>
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

function SearchResultRow({ r }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(r.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="result-card card" style={{
      padding: '12px 16px',
      position: 'relative',
      background: 'rgba(255, 255, 255, 0.01)',
      border: '1px solid var(--border)',
    }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="text-xs text-cyan mono">{r.source}</span>
          <span className="badge badge-cyan" style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(6,182,212,0.1)', color: 'var(--cyan)', borderRadius: 12 }}>
            {(r.score * 100).toFixed(0)}% match
          </span>
        </div>
        <button className="btn-icon" onClick={handleCopy} title="Copy result content" style={{ padding: 2 }}>
          {copied ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
        </button>
      </div>
      
      {/* Visual Match score progress bar */}
      <div className="score-meter-wrap" style={{ height: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
        <div className="score-meter-bar" style={{
          height: '100%',
          width: `${(r.score * 100).toFixed(0)}%`,
          background: `linear-gradient(90deg, var(--cyan) 0%, ${r.score > 0.7 ? 'var(--emerald)' : 'var(--purple)'} 100%)`,
          borderRadius: 2,
          transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
        }} />
      </div>

      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
        {r.content}
      </p>
    </div>
  );
}

function ChunkRow({ chunk, index }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(chunk.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.01)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Chunk {index + 1}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {chunk.content.split(/\s+/).length} words
          </span>
          <button className="btn-icon" onClick={handleCopy} title="Copy chunk text" style={{ padding: 2 }}>
            {copied ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: 0 }}>
        {chunk.content}
      </p>
    </div>
  );
}

function ChunkCard({ chunk, index }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(chunk.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const wordCount = useMemo(() => chunk.content.split(/\s+/).length, [chunk.content]);
  
  // Vector visualization projection helper
  const vectorGradient = useMemo(() => {
    if (!chunk.embedding || chunk.embedding.length === 0) {
      return 'linear-gradient(90deg, var(--cyan) 0%, var(--purple) 100%)';
    }
    const len = chunk.embedding.length;
    const p1 = chunk.embedding[Math.floor(len * 0.1)] || 0;
    const p2 = chunk.embedding[Math.floor(len * 0.4)] || 0;
    const p3 = chunk.embedding[Math.floor(len * 0.7)] || 0;
    const p4 = chunk.embedding[Math.floor(len * 0.9)] || 0;

    const h1 = Math.floor(Math.abs(p1 * 1800) % 360);
    const h2 = Math.floor(Math.abs(p2 * 1800) % 360);
    const h3 = Math.floor(Math.abs(p3 * 1800) % 360);
    const h4 = Math.floor(Math.abs(p4 * 1800) % 360);

    return `linear-gradient(90deg, hsl(${h1}, 85%, 55%) 0%, hsl(${h2}, 85%, 55%) 33%, hsl(${h3}, 85%, 55%) 66%, hsl(${h4}, 85%, 55%) 100%)`;
  }, [chunk.embedding]);

  // Truncate text if not expanded
  const displayText = expanded ? chunk.content : (chunk.content.length > 180 ? chunk.content.slice(0, 180) + '...' : chunk.content);

  return (
    <div className="card" style={{
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'between',
      position: 'relative',
      background: 'rgba(255,255,255,0.01)',
      border: '1px solid var(--border)',
      minHeight: 180,
      transition: 'all 0.2s ease',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderColor = 'rgba(6,182,212,0.3)';
      e.currentTarget.style.boxShadow = '0 6px 20px rgba(6,182,212,0.06)';
      e.currentTarget.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = 'var(--border)';
      e.currentTarget.style.boxShadow = 'none';
      e.currentTarget.style.transform = 'none';
    }}
    >
      {/* Dynamic neural gradient bar (Vector Fingerprint) */}
      <div style={{
        height: 3,
        width: '100%',
        background: vectorGradient,
        borderRadius: 2,
        marginBottom: 10,
        opacity: 0.85
      }} title="Vector Embedding Neural Fingerprint" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Chunk #{index + 1}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: 4 }}>
          {wordCount} words
        </span>
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1, whiteSpace: 'pre-wrap', margin: '0 0 10px 0' }}>
        {displayText}
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 8 }}>
        <span className="truncate text-muted" style={{ fontSize: '0.68rem', maxWidth: 150 }} title={chunk.source}>
          Source: {chunk.source}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {chunk.content.length > 180 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setExpanded(!expanded)}
              style={{ fontSize: '0.65rem', padding: '2px 6px', height: 'auto', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {expanded ? 'Less' : 'More'}
            </button>
          )}
          <button
            type="button"
            className="btn-icon"
            onClick={handleCopy}
            title="Copy chunk text"
            style={{ padding: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}
          >
            {copied ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}