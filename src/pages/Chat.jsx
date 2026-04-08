// ================================================================
// Chat.jsx — Main AI Chat Interface (Enhanced)
// NEW: Confidence scoring on AI responses
// NEW: 5-tier model system with smart suggestions
// ENHANCED: Better model selection UI with adjectives
// ================================================================

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Image, Mic, MicOff, Plus, Trash2, ChevronRight,
  Sparkles, User, Copy, Check, StopCircle, FileText,
  ShieldAlert, ShieldCheck, Download, AlertTriangle, Info,
  Edit2, RefreshCw, PanelLeftClose, PanelLeft, X
} from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { useThreatDetector } from '../hooks/useThreadDetector';
import { useClipboardGuard } from '../hooks/useClipboardGuard';
import { useSessionVault } from '../hooks/useSessionVault';
import { initDB, hybridSearch } from '../lib/orama';
import { calculateConfidenceScore } from '../lib/deviceProfile';
import ReactMarkdown from '../components/ReactMarkdown';

// ── Memoized MessageRow to prevent lag during streaming ──────────────
const MessageItem = memo(({ msg, isLastMsg, onCopy, copiedId, onEdit, onRetry }) => {
  return (
    <div className={`message-row ${msg.role}`}>
      <div className="msg-avatar">
        {msg.role === 'user' ? <User size={16} /> : <Sparkles size={18} fill="currentColor" />}
      </div>
      <div className="msg-bubble">
        {msg.image && <img src={msg.image} alt="attached" className="msg-image" />}
        {msg._hadImage && !msg.image && (
          <div className="text-xs text-muted" style={{ marginBottom: 8, fontStyle: 'italic' }}>
            [Image not persisted — reattach to use again]
          </div>
        )}
        <div className="md-content">
          <ReactMarkdown content={msg.content} isStreaming={!!msg.streaming} />
          {msg.streaming && <span className="cursor-blink">▍</span>}
        </div>

        {msg.role === 'assistant' && !msg.streaming && msg.confidence && (
          <div className="confidence-badge" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            marginTop: 8,
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
            backgroundColor: msg.confidence.level === 'high' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
            color: msg.confidence.level === 'high' ? 'var(--emerald)' : 'var(--amber)',
            border: `1px solid ${msg.confidence.level === 'high' ? 'var(--emerald)' : 'var(--amber)'}`,
          }}>
            <span>{msg.confidence.display}</span>
            <div className="confidence-tooltip" title={msg.confidence.explanation}>
              <Info size={12} style={{ opacity: 0.7 }} />
            </div>
          </div>
        )}

        <div className="msg-footer">
          <span className="text-xs text-muted">{msg.timestamp}</span>
          {!msg.streaming && (
            <div className="msg-actions">
              <button className="btn-icon" onClick={() => onCopy(msg.id, msg.content)} title="Copy">
                {copiedId === msg.id ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
              </button>
              {msg.role === 'user' && (
                <button className="btn-icon" onClick={() => onEdit(msg.id, msg.content)} title="Edit prompt">
                  <Edit2 size={14} />
                </button>
              )}
              {msg.role === 'assistant' && isLastMsg && (
                <button className="btn-icon" onClick={() => onRetry(msg.id)} title="Regenerate response">
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function newConversation() {
  return { id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: Date.now() };
}

// Strip base64 image data before persisting to avoid 5MB localStorage limit
function stripImagesForStorage(conversations) {
  return conversations.map(conv => ({
    ...conv,
    messages: conv.messages.map(msg =>
      msg.image
        ? { ...msg, image: null, _hadImage: true }
        : msg
    ),
  }));
}

export default function Chat() {
  const { model } = useApp();
  const navigate = useNavigate();
  const vault = useSessionVault();

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
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // ── Security hooks ─────────────────────────────────────────────────
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

  // ── Vault load ─────────────────────────────────────────────────────
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

  // Strip base64 images before saving
  useEffect(() => {
    if (conversations.length > 0) {
      vault.saveConversations(stripImagesForStorage(conversations));
    }
  }, [conversations]);

  const activeConv = useMemo(() =>
    conversations.find(c => c.id === activeId), [conversations, activeId]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages]);

  // ── Auto-resize textarea ───────────────────────────────────────────
  const handleInputChange = (e) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    setInput(e.target.value);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback(createPasteHandler((pastedText) => {
    setInput(prev => prev + pastedText);
  }), [createPasteHandler]);

  // ── PII detection ──────────────────────────────────────────────────
  const checkPII = (text) => {
    const patterns = [
      { type: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
      { type: 'phone', regex: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
      { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
      { type: 'credit card', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/ },
    ];
    const found = patterns.filter(p => p.regex.test(text)).map(p => p.type);
    return found.length > 0 ? found : null;
  };

  // ── Image attachment ───────────────────────────────────────────────
  const handleImageFile = async (file) => {
    const reader = new FileReader();
    reader.onload = (e) => setAttachedImage(e.target.result);
    reader.readAsDataURL(file);
  };

  // ── Voice recording ────────────────────────────────────────────────
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioChunks.current = [];
        recorder.ondataavailable = (e) => audioChunks.current.push(e.data);
        recorder.onstop = async () => {
          const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const text = await model.transcribeAudio(arrayBuffer);
          setInput(prev => prev + (prev ? ' ' : '') + text);
          stream.getTracks().forEach(t => t.stop());
        };
        mediaRecRef.current = recorder;
        recorder.start();
        setIsRecording(true);
      } catch (err) {
        alert('Microphone access denied');
      }
    }
  };

  // ── RAG search ─────────────────────────────────────────────────────
  const searchRAG = async (query) => {
    try {
      const results = await hybridSearch(query, { limit: 3 });
      setRagContext(results);
      return results.map(r => r.text).join('\n\n');
    } catch {
      return '';
    }
  };

  // ── Interaction runner ─────────────────────────────────────────────
  const runInteraction = async (userText, attachedImg, currentMsgs) => {
    setIsStreaming(true);
    abortRef.current = false;

    const pii = checkPII(userText);
    if (pii) {
      setPiiWarning(`Detected possible ${pii.join(', ')} in your message. Data stays local.`);
      setTimeout(() => setPiiWarning(null), 6000);
    }

    await scanInput(userText);

    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      image: attachedImg,
      timestamp: new Date().toLocaleTimeString(),
    };

    const updatedMsgs = [...currentMsgs, userMsg];

    setConversations(prev => prev.map(c =>
      c.id === activeId ? { ...c, messages: updatedMsgs } : c
    ));

    const ragText = await searchRAG(userText);
    const hasRagContext = ragText.length > 0;

    const systemPrompt = `You are Sentry AI, a private local AI assistant. Be helpful, accurate, and concise.${hasRagContext ? `\n\nContext from user documents:\n${ragText}` : ''}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...currentMsgs.filter(m => !m.streaming).map(m => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: userText },
    ];

    const assistantId = crypto.randomUUID();
    const assistantMsg = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      timestamp: new Date().toLocaleTimeString(),
      hasRagContext,
    };

    setConversations(prev => prev.map(c =>
      c.id === activeId ? { ...c, messages: [...updatedMsgs, assistantMsg] } : c
    ));

    try {
      const result = await model.chat(messages, (delta, full, done) => {
        if (abortRef.current) return;
        setConversations(prev => prev.map(c =>
          c.id === activeId ? {
            ...c,
            messages: c.messages.map(m =>
              m.id === assistantId ? { ...m, content: full, streaming: !done } : m
            ),
          } : c
        ));
      });

      if (abortRef.current) return;

      if (result?.content) {
        const confidence = calculateConfidenceScore(
          hasRagContext,
          model.modelTier || 'BALANCED',
          result.content.length
        );

        setConversations(prev => prev.map(c =>
          c.id === activeId ? {
            ...c,
            messages: c.messages.map(m =>
              m.id === assistantId ? {
                ...m,
                content: result.content,
                streaming: false,
                confidence,
              } : m
            ),
          } : c
        ));

        setConversations(prev => prev.map(c => {
          if (c.id === activeId && currentMsgs.length === 0) {
            const title = userText.slice(0, 40) + (userText.length > 40 ? '…' : '');
            return { ...c, title };
          }
          return c;
        }));
      }
    } catch (err) {
      console.error('Chat error:', err);
      setConversations(prev => prev.map(c =>
        c.id === activeId ? {
          ...c,
          messages: c.messages.map(m =>
            m.id === assistantId ? {
              ...m,
              content: 'Error: ' + err.message,
              streaming: false,
            } : m
          ),
        } : c
      ));
    }

    setIsStreaming(false);
    setRagContext([]);
  };

  // ── Main send handler ──────────────────────────────────────────────
  const handleSend = async () => {
    if ((!input.trim() && !attachedImage) || !model.isReady || isStreaming) return;

    const userText = input.trim();
    const currentImg = attachedImage;

    setInput('');
    setAttachedImage(null);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    await runInteraction(userText, currentImg, activeConv.messages);
  };

  // ── Edit message ───────────────────────────────────────────────────
  const handleEditMessage = useCallback((msgId, content) => {
    if (isStreaming) return;
    setConversations(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const index = c.messages.findIndex(m => m.id === msgId);
      if (index === -1) return c;
      return { ...c, messages: c.messages.slice(0, index) };
    }));
    setInput(content);
    if (inputRef.current) inputRef.current.focus();
  }, [activeId, isStreaming]);

  // ── Retry message ───────────────────────────────────────────────────
  const handleRetryMessage = useCallback(async (msgId) => {
    if (isStreaming || !model.isReady) return;
    
    let userText = '';
    let attachedImg = null;
    let prevMsgs = [];

    setConversations(prev => {
      const c = prev.find(conv => conv.id === activeId);
      if (c) {
        const index = c.messages.findIndex(m => m.id === msgId);
        if (index > 0) {
           const userMsg = c.messages[index - 1]; // user message
           userText = userMsg.content;
           attachedImg = userMsg.image;
           prevMsgs = c.messages.slice(0, index - 1);
           return prev.map(conv => conv.id === activeId ? { ...conv, messages: prevMsgs } : conv);
        }
      }
      return prev;
    });

    if (userText) {
      setTimeout(() => {
        runInteraction(userText, attachedImg, prevMsgs);
      }, 0);
    }
  }, [activeId, isStreaming, model.isReady]);

  // ── Copy message ───────────────────────────────────────────────────
  const copyMessage = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Export conversations ───────────────────────────────────────────
  const exportConversations = () => {
    const data = JSON.stringify(conversations, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentry-conversations-${Date.now()}.json`;
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

  if (!model.isReady) {
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
    <div className={`chat-layout ${!isSidebarOpen ? 'layout-collapsed' : ''}`}>
      {/* Sidebar */}
      <div className={`conv-sidebar ${!isSidebarOpen ? 'collapsed' : ''}`}>
        <div className="conv-sidebar-header">
          <span className="sidebar-title text-sm text-muted">Conversations</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn-icon" onClick={exportConversations} title="Export all conversations">
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
              <span className="text-xs text-muted">{threatLog.length} threat{threatLog.length > 1 ? 's' : ''} detected</span>
            </div>
          </div>
        )}
      </div>

      {/* Chat main */}
      <div className="chat-main">
        {/* Top actions */}
        <div className="chat-topbar" style={{
          padding: '12px 24px', 
          display: 'flex', 
          justifyContent: 'flex-start',
          borderBottom: '1px solid transparent'
        }}>
          <button 
            className="btn-icon" 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {isSidebarOpen ? <PanelLeftClose size={18} className="text-muted" /> : <PanelLeft size={18} className="text-muted" />}
          </button>
        </div>
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
              <Sparkles size={40} className="text-cyan" style={{ marginBottom: 16 }} />
              <h3>What can I help with?</h3>
              <p className="text-muted text-sm hardware-greeting" style={{ fontFamily: 'system-ui', margin: '8px 0 32px 0' }}>
                Secure environment established. Running privately on your <strong>{model.hwProfile?.gpuInfo?.description || (model.hwProfile?.supportsWebGPU ? 'Local GPU' : 'CPU (WebAssembly)')}</strong> ({model.modelTier || 'UNIVERSAL'} Engine).
              </p>
              
              <div className="capability-grid">
                <div className="capability-block" onClick={() => navigate('/vault')}>
                  <div className="cap-icon-wrap"><FileText size={20} className="text-cyan" /></div>
                  <div className="cap-text">
                    <h4>Chat with Documents</h4>
                    <p>Drop PDFs here or visit the Vault to build your private knowledge base.</p>
                  </div>
                </div>
                
                <div className="capability-block" onClick={() => fileInputRef.current?.click()}>
                  <div className="cap-icon-wrap"><Image size={20} className="text-emerald" /></div>
                  <div className="cap-text">
                    <h4>Analyze an Image</h4>
                    <p>Click the image icon to process photos completely offline.</p>
                  </div>
                </div>

                <div className="capability-block" onClick={toggleRecording}>
                  <div className="cap-icon-wrap"><Mic size={20} className="text-purple" /></div>
                  <div className="cap-text">
                    <h4>Voice Conversation</h4>
                    <p>Use the microphone to run local, completely private audio transcription.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeConv?.messages.map((msg, index) => (
            <MessageItem
              key={msg.id}
              msg={msg}
              isLastMsg={index === activeConv.messages.length - 1}
              onCopy={copyMessage}
              copiedId={copiedId}
              onEdit={handleEditMessage}
              onRetry={handleRetryMessage}
            />
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
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask Sentry AI anything… (Enter to send)"
              rows={1}
              style={{ height: 'auto', overflowY: 'hidden' }}
            />

            <div className="input-security-icon" title={threatLog.length > 0 ? 'Threats detected this session' : 'Input scanning active'}>
              {threatLog.length > 0
                ? <ShieldAlert size={14} className="text-amber" />
                : <ShieldCheck size={14} className="text-emerald" />
              }
            </div>

            <button
              className={`btn-icon mic-btn ${isRecording ? 'recording' : ''}`}
              onClick={toggleRecording}
            >
              {isRecording ? <MicOff size={18} className="text-red" /> : <Mic size={18} />}
            </button>

            {isStreaming ? (
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => { 
                  abortRef.current = true; 
                  setIsStreaming(false); 
                  // Clean up stuck streaming cursors immediately
                  setConversations(prev => prev.map(c =>
                    c.id === activeId ? {
                      ...c,
                      messages: c.messages.map(m =>
                        m.streaming ? { ...m, streaming: false } : m
                      )
                    } : c
                  ));
                }}
              >
                <StopCircle size={14} /> Stop
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm send-btn"
                onClick={handleSend}
                disabled={(!input.trim() && !attachedImage) || !model.isReady}
              >
                <Send size={14} />
              </button>
            )}
          </div>
          
          <div className="text-xs text-muted" style={{ textAlign: 'center', marginTop: 12, opacity: 0.7, maxWidth: 600, alignSelf: 'center', margin: '12px auto 0 auto', lineHeight: 1.4 }}>
             Sentry AI runs entirely on your device's hardware. For best results, provide context or upload documents for it to analyze, as local models may hallucinate general trivia.
          </div>
        </div>
      </div>
    </div>
  );
}