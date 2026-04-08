import { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronRight, AlertTriangle, Trash2, ShieldCheck, Smartphone, Brain, MessageSquareWarning, FolderOpen, HardDrive, Cpu, Image, FileText, WifiOff } from 'lucide-react';
import '../pages/pages.css';

export default function Help() {
  const [openAccordion, setOpenAccordion] = useState('install');

  const toggleAccordion = (id) => {
    setOpenAccordion(openAccordion === id ? null : id);
  };

  const clearLocalData = async () => {
    const confirmDelete = window.confirm(
      "DANGER: Are you sure? This will completely wipe all downloaded AI models, your chat history, and your private document Vault. You cannot undo this action."
    );
    if (!confirmDelete) return;

    try {
      // 1. Clear LocalStorage
      localStorage.clear();
      
      // 2. Clear OPFS (Vector Database & Files)
      try {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
      } catch (e) {
        console.warn("OPFS clear skipped or unsupported:", e);
      }

      // 3. Clear Caches (.onnx web-llm / transformers.js models)
      try {
        const cacheKeys = await caches.keys();
        for (const key of cacheKeys) {
          await caches.delete(key);
        }
      } catch (e) {
        console.warn("CacheStorage clear skipped:", e);
      }
      
      // 4. Clear IndexedDB (used by some local-first caching libs)
      try {
        if (window.indexedDB && window.indexedDB.databases) {
          const dbs = await window.indexedDB.databases();
          dbs.forEach(db => window.indexedDB.deleteDatabase(db.name));
        }
      } catch (e) {
        console.warn("IndexedDB clear skipped:", e);
      }

      alert("All local data has been successfully obliterated. Reloading application...");
      window.location.href = '/';
    } catch (error) {
      console.error("Error wiping data:", error);
      alert("Encountered an error wiping data, but attempting reload...");
      window.location.href = '/';
    }
  };

  const faqCategories = [
    {
      name: "🚀 Getting Started & Troubleshooting",
      questions: [
        {
          id: 'install',
          icon: <Smartphone size={18} className="text-cyan" />,
          title: "How do I install this on my phone?",
          content: (
            <>
              <p>Sentry AI is a Progressive Web App (PWA), meaning it runs deeply integrated with your operating system without needing an App Store.</p>
              <ul style={{ marginLeft: '20px', marginTop: '10px' }}>
                <li><strong>iOS (iPhone/iPad):</strong> Tap the <em>Share icon</em> <span style={{fontSize: '1.2em'}}>⇡</span> at the bottom of Safari, scroll down, and select <strong>"Add to Home Screen"</strong>.</li>
                <li><strong>Android:</strong> You will typically see an automatic prompt to "Install App" at the bottom of your screen. If not, tap the three dots menu in Chrome and select <strong>"Install app"</strong> or "Add to Home screen".</li>
              </ul>
            </>
          )
        },
        {
          id: 'crash',
          icon: <AlertTriangle size={18} className="text-amber" />,
          title: "Why did the app crash or show 'Aw, Snap!'?",
          content: (
            <>
              <p>Downloading and parsing Large Language Models locally requires a temporary spike in memory (RAM). If your browser runs out of memory, it may forcefully close the tab.</p>
              <p style={{ marginTop: '10px' }}><strong>How to fix it:</strong> Close all other heavy tabs to free up memory. You can also try clearing your browser cache or switching to the lightweight "UNIVERSAL" CPU engine using the button at the bottom of this page.</p>
            </>
          )
        },
        {
          id: 'stuck',
          icon: <Brain size={18} className="text-purple" />,
          title: "The AI model is stuck downloading. What do I do?",
          content: (
            <>
              <p>Occasionally, an interrupted Wi-Fi connection can leave a corrupted model fragment in your browser cache, preventing the download from completing.</p>
              <p style={{ marginTop: '10px' }}>Use the red <strong>Clear All Local Data</strong> button under the Privacy Control section below to obliterate the corrupted cache, then reload the page.</p>
            </>
          )
        }
      ]
    },
    {
      name: "🛡️ Privacy & Security",
      questions: [
        {
          id: 'offline',
          icon: <WifiOff size={18} className="text-cyan" />,
          title: "How do I know Sentry AI is actually offline?",
          content: (
            <>
              <p>We encourage you to test it! Once the initial "brain" (model) is downloaded, Sentry AI operates completely independently.</p>
              <p style={{ marginTop: '10px' }}>You can turn on Airplane Mode, disable Wi-Fi, and turn off cellular data—the AI will continue to chat and process your documents without interruption. Our built-in "Air-Gap" mode physically blocks the app from sending any data out of your browser.</p>
            </>
          )
        },
        {
          id: 'history',
          icon: <HardDrive size={18} className="text-emerald" />,
          title: "Are my chats saved when I close the app?",
          content: (
            <>
              <p>Yes, but strictly on your device. Sentry AI uses your browser's secure local database (IndexedDB) to save your chat history and Vault documents.</p>
              <p style={{ marginTop: '10px' }}>This means your data is persistent between sessions, but it never touches a cloud server. You can wipe this history at any time using the "Clear Local Data" button.</p>
            </>
          )
        }
      ]
    },
    {
      name: "⚡ Performance & Hardware",
      questions: [
        {
          id: 'compatibility',
          icon: <Smartphone size={18} className="text-cyan" />,
          title: "Which browsers and devices are fully supported?",
          content: (
            <>
              <p>For the ultimate experience with hardware acceleration, Sentry AI requires a modern Chromium-based browser (<strong>Chrome, Edge, Brave</strong>) that supports WebGPU on a desktop or laptop.</p>
              <p style={{ marginTop: '10px' }}>If you are on an <strong>iPhone (Safari)</strong> or an older mobile device, Sentry AI will still work! It automatically detects your environment and falls back to a dedicated WebAssembly (WASM) engine. Note that devices with less than 4GB of RAM may struggle to load larger models.</p>
            </>
          )
        },
        {
          id: 'slow',
          icon: <Cpu size={18} className="text-amber" />,
          title: "Why is the AI typing slowly?",
          content: (
            <>
              <p>Speed depends strictly on your device's hardware. If Sentry AI detected that your device doesn't support WebGPU (high-speed graphics processing), it automatically switched to the "Lite Engine" (WASM).</p>
              <p style={{ marginTop: '10px' }}>This runs the AI on your standard processor (CPU), which is highly secure and stable but slightly slower. For the fastest speeds, we recommend using Sentry on a desktop or laptop with a dedicated graphics card.</p>
            </>
          )
        },
        {
          id: 'storage',
          icon: <HardDrive size={18} className="text-purple" />,
          title: "How much storage space does Sentry AI take up?",
          content: (
            <>
              <p>The web app itself is a tiny 5MB, but the offline AI models require space. Depending on your device's diagnostic test, Sentry AI will securely cache between 300MB and 1.5GB of model data in your browser's storage.</p>
              <p style={{ marginTop: '10px' }}>This is a one-time download that allows the AI to run instantly on your next visit.</p>
            </>
          )
        }
      ]
    },
    {
      name: "📄 Using The Vault & Features",
      questions: [
        {
          id: 'hallucinations',
          icon: <MessageSquareWarning size={18} className="text-emerald" />,
          title: "Why is the AI giving me incorrect facts?",
          content: (
            <>
              <p>Local AI models are effectively "calculators for words," not encyclopedias. Because Sentry runs locally without server-racks of memory, it doesn't store the entire internet's history.</p>
              <p style={{ marginTop: '10px' }}>Instead of asking it for historical facts, use it as a private processing assistant: upload documents into your Vault for it to summarize, or ask it to fix your grammar!</p>
            </>
          )
        },
        {
          id: 'long_pdf',
          icon: <FileText size={18} className="text-cyan" />,
          title: "Why won't the Vault summarize my entire 50-page PDF at once?",
          content: (
            <>
              <p>Because Sentry AI runs entirely on your local hardware, it has a strict "memory limit" (Context Window) for how much text it can process simultaneously. If a document is too large, it must truncate the text.</p>
              <p style={{ marginTop: '10px' }}><strong>Best Practice:</strong> Try breaking your request down. Ask specific questions like "Summarize chapter 2" rather than asking it to process a massive book in one go.</p>
            </>
          )
        },
        {
          id: 'image',
          icon: <Image size={18} className="text-purple" />,
          title: "Can Sentry AI read my images?",
          content: (
            <>
              <p>Yes! Using the attachment icon in the chat bar, you can upload images directly into the chat.</p>
              <p style={{ marginTop: '10px' }}>The Vision engine runs locally to extract text (OCR) or describe the contents of the image. Note: Processing complex images may take a few extra seconds on mobile devices.</p>
            </>
          )
        }
      ]
    }
  ];

  return (
    <div className="help-page page-content">
      <div className="page-header">
        <div>
          <h2><HelpCircle size={24} className="text-cyan" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }} /> Help & Troubleshooting</h2>
          <p className="text-muted text-sm">Learn how to maximize your local AI experience.</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {faqCategories.map((category) => (
          <div key={category.name} className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>{category.name}</h2>
            <div className="faq-accordion">
              {category.questions.map(faq => (
                <div 
                  key={faq.id} 
                  className={`faq-item ${openAccordion === faq.id ? 'active' : ''}`}
                >
                  <div 
                    className="faq-summary" 
                    onClick={() => toggleAccordion(faq.id)}
                  >
                    <div className="faq-title-wrap">
                      {faq.icon}
                      <span style={{ fontWeight: 600 }}>{faq.title}</span>
                    </div>
                    {openAccordion === faq.id ? <ChevronDown size={18} className="text-muted" /> : <ChevronRight size={18} className="text-muted" />}
                  </div>
                  {openAccordion === faq.id && (
                    <div className="faq-details fade-in">
                      {faq.content}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* ── Nuke Button Area ── */}
        <div className="card" style={{ padding: '24px', marginTop: '24px', border: '1px solid rgba(255, 71, 87, 0.3)' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--red)' }}>
            <Trash2 size={20} /> Privacy Control (Danger Zone)
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            If you are experiencing persistent crashes, corrupted downloads, or simply want to nuke all traces of your activity from this device, you can completely reset the application here.
          </p>

          <button 
            className="btn btn-danger" 
            onClick={clearLocalData}
            style={{ width: '100%', padding: '14px', display: 'flex', justifyContent: 'center' }}
          >
            Clear All Local Data & Models
          </button>
        </div>
      </div>
    </div>
  );
}
