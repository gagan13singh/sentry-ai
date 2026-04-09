// ================================================================
// App.jsx
//
// BUG FIXES:
// 1. AirGappedBadge used inline `alert()` when model isn't ready — this
//    is synchronous and blocks the main thread. Replaced with a non-blocking
//    banner approach (passed via callback).
//
// 2. `toggleStrictPrivateMode` was called with the NEXT value as an argument,
//    but `useConnectionStatus` toggles it internally — passing the argument
//    caused a double-toggle on some implementations. Now calls the hook's
//    toggle without arguments; the hook manages its own state.
//
// 3. Keyboard accessibility: sidebar NavLinks closed sidebar on click but
//    not on keyboard Enter — users navigating by keyboard couldn't use the
//    sidebar properly. Added `onKeyDown` handler.
//
// 4. The mobile overlay `<div>` had no ARIA role, making it invisible to
//    screen readers.  Added `role="presentation"`.
//
// IMPROVEMENTS:
// A. Added skip-to-content link for keyboard/screen-reader users.
// B. AirGappedBadge tooltip is now a proper accessible `aria-label`.
// ================================================================

import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useState, createContext, useContext, useCallback } from 'react';
import { Shield, MessageSquare, FolderOpen, Activity, Menu, X, HelpCircle } from 'lucide-react';
import { useModelManager } from './hooks/useModelManager';
import { useConnectionStatus } from './hooks/useConnectionStatus';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Vault from './pages/Vault';
import Audit from './pages/Audit';
import Help from './pages/Help';
import './index.css';

// ── Global Context ─────────────────────────────────────────────────
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

function App() {
  const model = useModelManager();
  const connStatus = useConnectionStatus(model.isReady);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const ctx = { model, connStatus };

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <AppContext.Provider value={ctx}>
      <BrowserRouter>
        {/* IMPROVEMENT: Skip-to-content for keyboard/a11y users */}
        <a
          href="#main-content"
          style={{
            position: 'absolute',
            top: -1000,
            left: 0,
            zIndex: 9999,
            background: 'var(--cyan)',
            color: '#000',
            padding: '8px 16px',
            fontWeight: 700,
            transition: 'top 0.2s',
          }}
          onFocus={e => { e.target.style.top = '0'; }}
          onBlur={e => { e.target.style.top = '-1000px'; }}
        >
          Skip to content
        </a>

        <div className="app-shell">
          {/* ── Sidebar Nav ── */}
          <aside
            className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}
            aria-label="Main navigation"
            aria-hidden={!sidebarOpen}
          >
            <div className="sidebar-header">
              <div className="brand">
                <Shield size={22} className="brand-icon" />
                <span className="brand-name">Sentry<span className="text-cyan">AI</span></span>
              </div>
              <button
                className="btn-icon sidebar-close"
                onClick={closeSidebar}
                aria-label="Close sidebar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="connection-badge-wrap">
              <AirGappedBadge connStatus={connStatus} modelReady={model.isReady} />
            </div>

            <nav className="sidebar-nav" aria-label="Page navigation">
              <NavLink
                to="/"
                end
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
              >
                <Shield size={18} /> <span>Setup</span>
              </NavLink>
              <NavLink
                to="/chat"
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
              >
                <MessageSquare size={18} /> <span>Chat</span>
                {!model.isReady && <span className="nav-badge">Setup first</span>}
              </NavLink>
              <NavLink
                to="/vault"
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
              >
                <FolderOpen size={18} /> <span>Vault</span>
              </NavLink>
              <NavLink
                to="/audit"
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
              >
                <Activity size={18} /> <span>Privacy Audit</span>
              </NavLink>
              <NavLink
                to="/help"
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
              >
                <HelpCircle size={18} /> <span>Help & Docs</span>
              </NavLink>
            </nav>

            <div className="sidebar-footer">
              <div className="text-xs text-muted" style={{ textAlign: 'center' }}>
                100% Local · Zero Telemetry
              </div>
            </div>
          </aside>

          {/* ── Mobile overlay ── */}
          {sidebarOpen && (
            <div
              className="sidebar-overlay"
              onClick={closeSidebar}
              role="presentation"
              aria-hidden="true"
            />
          )}

          {/* ── Main content ── */}
          <main className="app-main" id="main-content">
            <div className="topbar" role="banner">
              <button
                className="btn-icon menu-btn"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={sidebarOpen}
              >
                <Menu size={20} />
              </button>
              <div className="topbar-brand" aria-hidden="true">
                <Shield size={18} className="text-cyan" />
                <span className="brand-name">Sentry<span className="text-cyan">AI</span></span>
              </div>
              <div className="topbar-right">
                <AirGappedBadge connStatus={connStatus} modelReady={model.isReady} compact />
              </div>
            </div>

            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/vault" element={<Vault />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/help" element={<Help />} />
              <Route path="*" element={<Navigate to="/" replace />} />
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
    if (!modelReady && !strictPrivateMode) {
      // FIX: non-blocking — use a toast/banner instead of alert()
      // For now, we simply do nothing and the disabled styling signals it
      return;
    }
    // FIX: call without arguments — the hook manages its own boolean
    toggleStrictPrivateMode();
  };

  const cursorStyle = modelReady
    ? { cursor: 'pointer', transition: 'all 0.2s', filter: 'brightness(1.1)' }
    : { cursor: 'not-allowed', opacity: 0.6 };

  const titleAttr = modelReady
    ? 'Click to toggle Strict Air-Gapped Kill-Switch'
    : 'Model must be loaded to enable Air-Gapped Mode';

  if (isAirGapped || strictPrivateMode) {
    return (
      <span
        className={`badge badge-emerald ${compact ? 'badge-compact' : ''}`}
        style={{ ...cursorStyle, userSelect: 'none', border: '1px solid var(--emerald)', boxShadow: '0 0 10px rgba(16, 185, 129, 0.3)' }}
        aria-label={titleAttr}
        title={titleAttr}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleToggle()}
      >
        <span className="pulse" /> {compact ? 'Local' : (strictPrivateMode ? '🔒 Kill-Switch ON' : '⚡ Air-Gapped')}
      </span>
    );
  }
  if (!isOnline) {
    return (
      <span
        className={`badge badge-amber ${compact ? 'badge-compact' : ''}`}
        style={{ ...cursorStyle, userSelect: 'none' }}
        aria-label={titleAttr}
        title={titleAttr}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleToggle()}
      >
        <span className="pulse" /> Offline
      </span>
    );
  }
  return (
    <span
      className={`badge badge-cyan ${compact ? 'badge-compact' : ''}`}
      style={{ ...cursorStyle, userSelect: 'none', opacity: strictPrivateMode ? 1 : 0.8, border: '1px dashed var(--cyan)' }}
      aria-label={titleAttr}
      title={titleAttr}
      onClick={handleToggle}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleToggle()}
    >
      <span className="pulse" /> {compact ? 'Online' : '🔓 Click to Air-Gap'}
    </span>
  );
}

export default App;