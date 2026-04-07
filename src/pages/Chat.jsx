// ================================================================
// Chat.jsx — Main AI Chat Interface
// FIXED: GPU context loss → recovery banner, NOT "go to setup" redirect
// FIXED: Knowledge cutoff warning for post-2024 queries
// FIXED: Message history trimmed before send (matches worker sliding window)
// NEW:   useKnowledgeAugment — honest cutoff notices + RAG hint
// NEW:   isRecovering state shown in UI with auto-retry
// ================================================================

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Image, Mic, MicOff, Plus, Trash2, ChevronRight,
  Sparkles, User, Copy, Check, StopCircle, FileText,
  ShieldAlert, ShieldCheck, Download, AlertTriangle, RefreshCw,
  Clock, Info
} from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { useThreatDetector } from '../hooks/useThreadDetector';
import { useClipboardGuard } from '../hooks/useClipboardGuard';
import { useSessionVault } from '../hooks/useSessionVault';
import { useKnowledgeAugment } from '../hooks/useKnowledgeAugment';
import { initDB, hybridSearch } from '../lib/orama';
import ReactMarkdown from '../components/ReactMarkdown';

function newConversation() {
  return { id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: Date.now() };
}

export default function Chat() {
  const { model } = useApp();
  const navigate = useNavigate();
  const vault = useSessionVault();
  const knowledgeAugment = useKnowledgeAugment();

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [ragContext, setRagContext] = useState([]);
  const [threatBanner, setThreatBanner] = useState(null);
  const [piiWarning, setPiiWarning] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const mediaRecRef = useRef(null);
  const audioChunks = useRef([]);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);

  const { scanInput, threatLog } = useThreatDetector((threat) => {
    if (!threat.safe) {
      setThreatBanner({
        level: threat.score > 60 ? 'critical' : 'warning',
        threats: threat.threats,
        message: `Suspicious input detected: ${threat.threats.map(t => t.type).join(', ')}`,
      });
    }
  });

  const { createPasteHandler } = useClipboardGuard();

  useEffect(() => {
    vault.unlockEphemeral().then(() => {
      vault.loadConversations().then(saved => {
        if (saved?.length) {
          setConversations(saved);
          setActiveId(saved[0].id);
        } else {
          const c = newConversation();
          setConversations([c]);
          setActiveId(c.id);
        }
      });
    });
    initDB();
  }, []);

  useEffect(() => {
    if (conversations.length > 0) vault.saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, activeId]);

  const activeConv = useMemo(
    () => conversations.find(c => c.id === activeId) || conversations[0],
    [conversations, activeId]
  );

  function addMessage(convId, msg) {
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const msgs = [...c.messages, msg];
      const title = c.title === 'New Chat' && msgs.length === 2
        ? msgs[0].content.slice(0, 40) + (msgs[0].content.length > 40 ? '…' : '')
        : c.title;
      return { ...c, messages: msgs, title };
    }));
  }

  const handleSend = useCallback(async () => {
    if (!input.trim() && !attachedImage) return;
    if (!model.isReady) return;

    const userText = input.trim();
    const imageToSend = attachedImage;

    // ── Threat scan ──────────────────────────────────────────────
    if (userText) {
      const scan = await scanInput(userText, model.scanContentThreat);
      if (!scan.safe && scan.score > 60) {
        const proceed = window.confirm(
          `⚠️ Security Warning\n\nSentry AI detected potential threat:\n${scan.threats.map(t => `• ${t.type}`).join('\n')}\n\nSend anyway?`
        );
        if (!proceed) return;
      }
      if (scan.piiFound?.length > 0) {
        setPiiWarning(`Message may contain: ${scan.piiFound.join(', ')}. Stays on your device.`);
        setTimeout(() => setPiiWarning(null), 5000);
      }
    }

    // ── Knowledge cutoff check ───────────────────────────────────
    if (userText) {
      const { needsWarning, reason } = knowledgeAugment.analyzeQuery(userText);
      if (needsWarning) knowledgeAugment.showCutoffWarning(reason);
    }

    setInput('');
    setAttachedImage(null);
    setIsStreaming(true);
    setThreatBanner(null);
    abortRef.current = false;

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
      image: imageToSend,
      timestamp: new Date().toLocaleTimeString(),
    };
    addMessage(activeId, userMsg);

    // ── RAG ──────────────────────────────────────────────────────
    let context = [];
    if (userText) {
      try {
        const embedding = await model.embedText(userText);
        if (embedding) {
          context = await hybridSearch(userText, new Float32Array(embedding), 4);
          setRagContext(context);
        }
      } catch { }
    }

    let imageCaption = '';
    if (imageToSend) {
      try { imageCaption = await model.captionImage(imageToSend); } catch { }
    }

    // ── Build system prompt with cutoff context ──────────────────
    const { needsWarning } = knowledgeAugment.analyzeQuery(userText);
    const cutoffCtx = needsWarning
      ? knowledgeAugment.buildCutoffContext(context.length > 0)
      : '';

    const systemPrompt = `You are Sentry AI, a helpful, general-purpose local AI assistant.
Answer questions on ANY topic the user asks about. Be helpful, concise, and accurate.
${context.length ? `\n\n## Relevant context from user's private vault:\n${context.map((c, i) => `[${i + 1}] (${c.source}): ${c.content}`).join('\n\n')}` : ''}
${imageCaption ? `\n\n## Image description: ${imageCaption}` : ''}${cutoffCtx}`;

    // ── Sliding window: trim to last N messages before sending ───
    // Mirrors the worker-side trimming for consistency.
    const maxHistory = model.isMobile ? 8 : 24;
    const recentMsgs = (activeConv?.messages.slice(-maxHistory) || [])
      .map(m => ({ role: m.role, content: m.content }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentMsgs,
      { role: 'user', content: userText || (imageCaption ? `Describe: ${imageCaption}` : '') },
    ];

    const assistantId = (Date.now() + 1).toString();
    addMessage(activeId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString(),
      streaming: true,
    });

    try {
      await model.chat(messages, (delta, full, done) => {
        if (abortRef.current) return;
        setConversations(prev => prev.map(c => {
          if (c.id !== activeId) return c;
          return {
            ...c,
            messages: c.messages.map(m =>
              m.id === assistantId ? { ...m, content: full, streaming: !done } : m
            ),
          };
        }));
        if (done) setIsStreaming(false);
      });
    } catch (e) {
      setConversations(prev => prev.map(c => {
        if (c.id !== activeId) return c;
        return {
          ...c,
          messages: c.messages.map(m =>
            m.id === assistantId ? { ...m, content: `Error: ${e.message}`, streaming: false } : m
          ),
        };
      }));
      setIsStreaming(false);
    }
  }, [input, attachedImage, model, activeId, activeConv, scanInput, knowledgeAugment]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePaste = createPasteHandler(setInput, input);

  const handleImageFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => setAttachedImage(e.target.result);
    reader.readAsDataURL(file);
  };

  const toggleRecording = async () => {
    if (isRecording) { mediaRecRef.current?.stop(); setIsRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      audioChunks.current = [];
      rec.ondataavailable = e => audioChunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const text = await model.transcribeAudio(decoded.getChannelData(0));
        if (text) setInput(prev => prev + (prev ? ' ' : '') + text.trim());
      };
      rec.start();
      mediaRecRef.current = rec;
      setIsRecording(true);
    } catch { }
  };

  const copyMessage = (id, content) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportConversations = () => {
    const data = JSON.stringify(conversations, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentry-ai-conversations-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const newChat = () => {
    const c = newConversation();
    setConversations(prev => [c, ...prev]);
    setActiveId(c.id);
  };

  const deleteChat = (id) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (activeId === id && next.length) setActiveId(next[0].id);
      return next.length ? next : [newConversation()];
    });
  };

  // ── Model not loaded (first time) ─────────────────────────────────
  if (!model.isReady && !model.isRecovering) {
    return (
      <div className="not-ready-state">
        <Sparkles size={48} className="text-cyan" style={{ marginBottom: 16 }} />
        <h2>AI Not Loaded</h2>
        <p className="text-muted">Load a model first to start chatting.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          <ChevronRight size={16} /> Go to Setup
        </button>
      </div>
    );
  }

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className="conv-sidebar">
        <div className="conv-sidebar-header">
          <span className="text-sm text-muted">Conversations</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn-icon" onClick={exportConversations} title="Export all">
              <Download size={14} />
            </button>
            <button className="btn-icon" onClick={newChat} title="New chat">
              <Plus size={16} />
            </button>
          </div>
        </div>
        <div className="conv-list">
          {conversations.map(c => (
            <div
              key={c.id}
              className={`conv-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              <FileText size={14} className="text-muted" />
              <span className="conv-title truncate">{c.title}</span>
              <button className="conv-delete" onClick={e => { e.stopPropagation(); deleteChat(c.id); }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        {threatLog.length > 0 && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={12} className="text-amber" />
              <span className="text-xs text-muted">{threatLog.length} threat{threatLog.length > 1 ? 's' : ''} this session</span>
            </div>
          </div>
        )}
      </div>

      {/* Chat main */}
      <div className="chat-main">

        {/* ── GPU Recovery banner — shown INSTEAD of redirecting to setup ── */}
        {model.isRecovering && (
          <div className="recovery-banner">
            <RefreshCw size={15} className="recovery-spin" />
            <span className="text-sm">
              GPU context reloading from cache… <span className="text-muted">(usually 5-15s)</span>
            </span>
          </div>
        )}

        {/* ── Knowledge cutoff warning ── */}
        {knowledgeAugment.cutoffWarning && (
          <div className="cutoff-banner">
            <Clock size={14} />
            <span className="text-xs">
              <strong>Knowledge cutoff:</strong> {knowledgeAugment.cutoffWarning}
              {' '}Add relevant text to your <strong>Vault</strong> or paste it directly in chat for up-to-date answers.
            </span>
            <button className="btn-icon" style={{ padding: 2, marginLeft: 'auto' }}
              onClick={knowledgeAugment.dismissWarning}>✕</button>
          </div>
        )}

        {/* Security banners */}
        {threatBanner && (
          <div className={`threat-banner threat-${threatBanner.level}`}>
            <ShieldAlert size={16} />
            <span className="text-sm">{threatBanner.message}</span>
            <button className="btn-icon" onClick={() => setThreatBanner(null)} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
        )}
        {piiWarning && (
          <div className="pii-banner">
            <AlertTriangle size={14} className="text-amber" />
            <span className="text-xs">{piiWarning}</span>
          </div>
        )}

        <div className="messages-container">
          {(!activeConv || activeConv.messages.length === 0) && (
            <div className="empty-chat">
              <Sparkles size={40} className="text-cyan" />
              <h3>What can I help with?</h3>
              <p className="text-muted text-sm" style={{ fontFamily: 'system-ui' }}>
                Ask anything — docs, code, images, audio. All local.
              </p>
              {model.isMobile && (
                <p className="text-xs text-muted" style={{ marginTop: -8 }}>
                  📱 Mobile mode · 1B model · 8-message context window
                </p>
              )}
              <div className="starter-chips">
                {['Summarize my documents', 'Explain this code', 'Analyze this image'].map(s => (
                  <button key={s} className="starter-chip" onClick={() => setInput(s)}>
                    {s} <ChevronRight size={12} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recovery overlay on existing messages */}
          {model.isRecovering && activeConv?.messages.length > 0 && (
            <div className="recovery-overlay">
              <RefreshCw size={20} className="recovery-spin text-cyan" />
              <span className="text-sm text-muted">Restoring GPU context…</span>
            </div>
          )}

          {activeConv?.messages.map(msg => (
            <div key={msg.id} className={`message-row ${msg.role}`}>
              <div className="msg-avatar">
                {msg.role === 'user' ? <User size={16} /> : <Sparkles size={18} fill="currentColor" />}
              </div>
              <div className="msg-bubble">
                {msg.image && <img src={msg.image} alt="attached" className="msg-image" />}
                <div className="md-content">
                  <ReactMarkdown content={msg.content} isStreaming={!!msg.streaming} />
                  {msg.streaming && <span className="cursor-blink">▍</span>}
                </div>
                <div className="msg-footer">
                  <span className="text-xs text-muted">{msg.timestamp}</span>
                  {!msg.streaming && (
                    <button className="btn-icon msg-copy" onClick={() => copyMessage(msg.id, msg.content)}>
                      {copiedId === msg.id ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {ragContext.length > 0 && (
          <div className="rag-context-bar">
            <FileText size={12} className="text-cyan" />
            <span className="text-xs text-muted">
              Using {ragContext.length} chunks from: {[...new Set(ragContext.map(r => r.source))].join(', ')}
            </span>
          </div>
        )}

        <div className="chat-input-wrap">
          {attachedImage && (
            <div className="attached-preview">
              <img src={attachedImage} alt="preview" className="attached-thumb" />
              <button className="btn-icon" onClick={() => setAttachedImage(null)}>
                <Trash2 size={12} />
              </button>
            </div>
          )}

          <div className="chat-input-bar">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => e.target.files[0] && handleImageFile(e.target.files[0])}
            />
            <button className="btn-icon" onClick={() => fileInputRef.current?.click()} title="Attach image">
              <Image size={18} />
            </button>

            <textarea
              ref={inputRef}
              className="chat-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={model.isRecovering ? 'Restoring GPU context…' : 'Ask Sentry AI anything…'}
              disabled={model.isRecovering}
              rows={1}
            />

            <div className="input-security-icon"
              title={threatLog.length > 0 ? 'Threats detected this session' : 'Input scanning active'}>
              {threatLog.length > 0
                ? <ShieldAlert size={14} className="text-amber" />
                : <ShieldCheck size={14} className="text-emerald" />}
            </div>

            <button
              className={`btn-icon mic-btn ${isRecording ? 'recording' : ''}`}
              onClick={toggleRecording}
              disabled={model.isRecovering}
            >
              {isRecording ? <MicOff size={18} className="text-red" /> : <Mic size={18} />}
            </button>

            {isStreaming ? (
              <button className="btn btn-secondary btn-sm"
                onClick={() => { abortRef.current = true; setIsStreaming(false); }}>
                <StopCircle size={14} /> Stop
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm send-btn"
                onClick={handleSend}
                disabled={(!input.trim() && !attachedImage) || !model.isReady || model.isRecovering}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}