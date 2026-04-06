// ================================================================
// Chat.jsx — Main AI Chat Interface
// Streaming chat with RAG context, multimodal input
// ================================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Image, Mic, MicOff, Plus, Trash2, ChevronRight,
  Sparkles, User, Copy, Check, Paperclip, StopCircle, FileText
} from 'lucide-react';
import { useApp } from '../App';
import { MODEL_STATUS } from '../hooks/useModelManager';
import { initDB, hybridSearch } from '../lib/orama';
import ReactMarkdown from '../components/ReactMarkdown';

const STORAGE_KEY = 'sentry-ai-conversations';

function loadConversations() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveConversations(convs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convs.slice(0, 50)));
}

function newConversation() {
  return { id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: Date.now() };
}

export default function Chat() {
  const { model } = useApp();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState(() => {
    const saved = loadConversations();
    return saved.length ? saved : [newConversation()];
  });
  const [activeId, setActiveId] = useState(() => {
    const saved = loadConversations();
    return saved[0]?.id || conversations[0]?.id;
  });
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [ragContext, setRagContext] = useState([]);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const mediaRecRef = useRef(null);
  const audioChunks = useRef([]);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);

  const activeConv = conversations.find(c => c.id === activeId) || conversations[0];

  // Save to localStorage whenever conversations change
  useEffect(() => { saveConversations(conversations); }, [conversations]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, activeId]);

  // Init DB
  useEffect(() => { initDB(); }, []);

  // ── Helpers ────────────────────────────────────────────────────────
  function updateMessages(convId, updater) {
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, messages: updater(c.messages), title: c.title === 'New Chat' && c.messages.length === 0 ? c.title : c.title }
        : c
    ));
  }

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

  // ── Send message ───────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() && !attachedImage) return;
    if (!model.isReady) return;

    const userText = input.trim();
    const imageToSend = attachedImage;
    setInput('');
    setAttachedImage(null);
    setIsStreaming(true);
    abortRef.current = false;

    // Build user message
    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
      image: imageToSend,
      timestamp: new Date().toLocaleTimeString(),
    };
    addMessage(activeId, userMsg);

    // RAG retrieval
    let context = [];
    if (userText) {
      try {
        const embedding = await model.embedText(userText);
        if (embedding) {
          context = await hybridSearch(userText, embedding, 4);
          setRagContext(context);
        }
      } catch { /* no context */ }
    }

    // If there's an image, caption it first
    let imageCaption = '';
    if (imageToSend) {
      try {
        imageCaption = await model.captionImage(imageToSend);
      } catch { /* skip */ }
    }

    // Build messages for LLM
    const systemPrompt = `You are Sentry AI, a private, air-gapped intelligence assistant. You run entirely locally.
Be helpful, concise, and accurate.
${context.length ? `\n\n## Relevant context from user's private vault:\n${context.map((c, i) => `[${i + 1}] (${c.source}): ${c.content}`).join('\n\n')}` : ''}
${imageCaption ? `\n\n## Image description: ${imageCaption}` : ''}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...activeConv.messages.slice(-8).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText || (imageCaption ? `Describe this image: ${imageCaption}` : '') },
    ];

    // Optimistic assistant bubble
    const assistantId = (Date.now() + 1).toString();
    addMessage(activeId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString(),
      streaming: true,
    });

    // Stream tokens
    let fullContent = '';
    try {
      await model.chat(messages, (delta, full, done) => {
        if (abortRef.current) return;
        fullContent = full;
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
  }, [input, attachedImage, model, activeId, activeConv]);

  // ── Key handler ────────────────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Image attach ───────────────────────────────────────────────────
  const handleImageFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => setAttachedImage(e.target.result);
    reader.readAsDataURL(file);
  };

  // ── Audio recording ────────────────────────────────────────────────
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecRef.current?.stop();
      setIsRecording(false);
      return;
    }
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
        const channelData = decoded.getChannelData(0);
        const text = await model.transcribeAudio(channelData);
        if (text) setInput(prev => prev + (prev ? ' ' : '') + text.trim());
      };
      rec.start();
      mediaRecRef.current = rec;
      setIsRecording(true);
    } catch { /* mic denied */ }
  };

  // ── Copy message ───────────────────────────────────────────────────
  const copyMessage = (id, content) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── New / delete conversation ──────────────────────────────────────
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

  // ── Not ready state ────────────────────────────────────────────────
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
    <div className="chat-layout">
      {/* ── Conversation sidebar ── */}
      <div className="conv-sidebar">
        <div className="conv-sidebar-header">
          <span className="text-sm text-muted">Conversations</span>
          <button className="btn-icon" onClick={newChat} title="New chat">
            <Plus size={16} />
          </button>
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
              <button
                className="conv-delete"
                onClick={e => { e.stopPropagation(); deleteChat(c.id); }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="chat-main">
        {/* Messages */}
        <div className="messages-container">
          {activeConv?.messages.length === 0 && (
            <div className="empty-chat">
              <Sparkles size={40} className="text-cyan" />
              <h3>What can I help with?</h3>
              <p className="text-muted text-sm" style={{ fontFamily: 'system-ui' }}>Ask anything — docs, code, images, audio. All local.</p>
              <div className="starter-chips">
                {['Summarize my documents', 'Explain this code', 'Analyze this image'].map(s => (
                  <button key={s} className="starter-chip" onClick={() => setInput(s)}>
                    {s} <ChevronRight size={12} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeConv?.messages.map(msg => (
            <div key={msg.id} className={`message-row ${msg.role}`}>
              <div className="msg-avatar">
                {msg.role === 'user' ? <User size={16} /> : <Sparkles size={18} fill="currentColor" />}
              </div>
              <div className="msg-bubble">
                {msg.image && (
                  <img src={msg.image} alt="attached" className="msg-image" />
                )}
                <div className="md-content">
                  <ReactMarkdown content={msg.content} />
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

        {/* RAG context indicator */}
        {ragContext.length > 0 && (
          <div className="rag-context-bar">
            <FileText size={12} className="text-cyan" />
            <span className="text-xs text-muted">
              Using {ragContext.length} chunks from: {[...new Set(ragContext.map(r => r.source))].join(', ')}
            </span>
          </div>
        )}

        {/* Input area */}
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
              placeholder="Ask Sentry AI anything… (Enter to send, Shift+Enter for new line)"
              rows={1}
            />

            <button
              className={`btn-icon mic-btn ${isRecording ? 'recording' : ''}`}
              onClick={toggleRecording}
              title={isRecording ? 'Stop recording' : 'Record audio'}
            >
              {isRecording ? <MicOff size={18} className="text-red" /> : <Mic size={18} />}
            </button>

            {isStreaming ? (
              <button className="btn btn-secondary btn-sm" onClick={() => { abortRef.current = true; setIsStreaming(false); }}>
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
        </div>
      </div>
    </div>
  );
}
