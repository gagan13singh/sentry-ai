// App.jsx — Router + global state provider
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useState, createContext, useContext } from 'react';
import { Shield, MessageSquare, FolderOpen, Activity, Menu, X } from 'lucide-react';
import { useModelManager } from './hooks/useModelManager';
import { useConnectionStatus } from './hooks/useConnectionStatus';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Vault from './pages/Vault';
import Audit from './pages/Audit';
import './index.css';

// ── Global Context ────────────────────────────────────────────────
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

function App() {
  const model   = useModelManager();
  const connStatus = useConnectionStatus(model.isReady);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const ctx = { model, connStatus };

  return (
    <AppContext.Provider value={ctx}>
      <BrowserRouter>
        <div className="app-shell">
          {/* ── Sidebar Nav ── */}
          <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
              <div className="brand">
                <Shield size={22} className="brand-icon" />
                <span className="brand-name">Sentry<span className="text-cyan">AI</span></span>
              </div>
              <button className="btn-icon sidebar-close" onClick={() => setSidebarOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="connection-badge-wrap">
              <AirGappedBadge connStatus={connStatus} modelReady={model.isReady} />
            </div>

            <nav className="sidebar-nav">
              <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}>
                <Shield size={18} /> <span>Setup</span>
              </NavLink>
              <NavLink to="/chat" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}>
                <MessageSquare size={18} /> <span>Chat</span>
                {!model.isReady && <span className="nav-badge">Setup first</span>}
              </NavLink>
              <NavLink to="/vault" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}>
                <FolderOpen size={18} /> <span>Vault</span>
              </NavLink>
              <NavLink to="/audit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}>
                <Activity size={18} /> <span>Privacy Audit</span>
              </NavLink>
            </nav>

            <div className="sidebar-footer">
              <div className="text-xs text-muted" style={{ textAlign: 'center' }}>
                100% Local · Zero Telemetry
              </div>
            </div>
          </aside>

          {/* ── Mobile overlay ── */}
          {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

          {/* ── Main content ── */}
          <main className="app-main">
            <div className="topbar">
              <button className="btn-icon menu-btn" onClick={() => setSidebarOpen(true)}>
                <Menu size={20} />
              </button>
              <div className="topbar-brand">
                <Shield size={18} className="text-cyan" />
                <span className="brand-name">Sentry<span className="text-cyan">AI</span></span>
              </div>
              <div className="topbar-right">
                <AirGappedBadge connStatus={connStatus} modelReady={model.isReady} compact />
              </div>
            </div>

            <Routes>
              <Route path="/"      element={<Home />} />
              <Route path="/chat"  element={<Chat />} />
              <Route path="/vault" element={<Vault />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="*"      element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AppContext.Provider>
  );
}

function AirGappedBadge({ connStatus, modelReady, compact = false }) {
  const { isOnline, isAirGapped, strictPrivateMode, toggleStrictPrivateMode } = connStatus;

  const handleToggle = () => {
    // Only allow manual toggle if AI is downloaded and ready!
    if (!modelReady && !strictPrivateMode) {
      alert("Please download the AI model first before shutting off the network completely.");
      return;
    }
    toggleStrictPrivateMode(!strictPrivateMode);
  };

  const cursorStyle = modelReady ? { cursor: 'pointer', transition: 'all 0.2s', filter: 'brightness(1.1)' } : {};
  let titleAttr = modelReady 
    ? "Click to toggle Strict Air-Gapped Kill-Switch" 
    : "Model must be loaded to enable Air-Gapped Mode";

  if (isAirGapped || strictPrivateMode) {
    return (
      <span 
        className={`badge badge-emerald ${compact ? 'badge-compact' : ''}`}
        style={{ ...cursorStyle, userSelect: 'none', border: '1px solid var(--emerald)', boxShadow: '0 0 10px rgba(16, 185, 129, 0.3)' }}
        title={titleAttr}
        onClick={handleToggle}
      >
        <span className="pulse" /> {compact ? 'Local Only' : (strictPrivateMode ? '🔒 Active Kill-Switch' : '⚡ Air-Gapped')}
      </span>
    );
  }
  if (!isOnline) {
    return (
      <span 
        className={`badge badge-amber ${compact ? 'badge-compact' : ''}`}
        style={{ ...cursorStyle, userSelect: 'none' }}
        title={titleAttr}
        onClick={handleToggle}
      >
        <span className="pulse" /> Offline
      </span>
    );
  }
  return (
    <span 
      className={`badge badge-cyan ${compact ? 'badge-compact' : ''}`}
      style={{ 
        ...cursorStyle, 
        userSelect: 'none', 
        opacity: strictPrivateMode ? 1 : 0.8,
        border: '1px dashed var(--cyan)' 
      }}
      title={titleAttr}
      onClick={handleToggle}
    >
      <span className="pulse" /> {compact ? 'Network Open' : '🔓 Click to Air-Gap'}
    </span>
  );
}

export default App;
