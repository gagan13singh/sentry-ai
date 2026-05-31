import { useState, useEffect } from 'react';
import { HelpCircle, ChevronDown, ChevronRight, AlertTriangle, Trash2, ShieldCheck, Smartphone, Brain, MessageSquareWarning, FolderOpen, HardDrive, Cpu, Image, FileText, WifiOff, Sparkles, AlertCircle } from 'lucide-react';
import '../pages/pages.css';
import { Link } from 'react-router-dom';
import { detectHardwareProfile } from '../lib/deviceProfile';

export default function Help() {
  const [openAccordion, setOpenAccordion] = useState('install');
  const [profile, setProfile] = useState(null);
  const [checkingHardware, setCheckingHardware] = useState(true);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const result = await detectHardwareProfile();
        if (active) {
          setProfile(result);
          setCheckingHardware(false);
        }
      } catch (err) {
        console.error("Hardware profile check failed", err);
        if (active) {
          setCheckingHardware(false);
        }
      }
    }
    check();
    return () => { active = false; };
  }, []);

  const isChromiumBrowser = () => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    const isChrome = ua.includes('chrome') || ua.includes('chromium') || ua.includes('crios');
    const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium') && !ua.includes('crios');
    const isFirefox = ua.includes('firefox') || ua.includes('fxios');
    const isMobile = /mobi|android|iphone|ipad|ipod/i.test(ua);
    return isChrome && !isSafari && !isFirefox && !isMobile;
  };

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
        },
        {
          id: 'gemini-privacy',
          icon: <ShieldCheck size={18} className="text-emerald" />,
          title: "What is Google Gemini Nano and is it completely private?",
          content: (
            <>
              <p>Google Gemini Nano is a highly optimized, native large language model developed by Google and built directly into modern Chromium browsers (Chrome, Edge, Brave). Unlike general web models that load large weights in memory via JavaScript wrappers, Gemini Nano runs as a secure browser process.</p>
              <p style={{ marginTop: '10px' }}><strong>Complete Client-Side Privacy:</strong> When you run Gemini Nano, Sentry AI communicates directly with Chrome's local <strong>Prompt API</strong>. All processing, computations, tokenization, and generation stay strictly inside your local machine's memory (RAM) and execute on your processor/graphics hardware. <strong>Zero bytes of data (no chat messages, no files, no document texts) are ever sent to Google, OpenAI, Sentry AI, or any external servers.</strong> It is 100% offline-ready and private.</p>
              <p style={{ marginTop: '10px' }}><strong>Sandbox Security:</strong> Because the engine runs within the browser's native process sandbox, it inherits all browser security guarantees. It cannot access your host operating system's files, registry, or local network, ensuring absolute safety.</p>
            </>
          )
        },
        {
          id: 'gemini-how-it-works',
          icon: <Brain size={18} className="text-purple" />,
          title: "How does Gemini Nano work under the hood? (Full Transparency)",
          content: (
            <>
              <p>Gemini Nano represents a major architectural milestone for web applications. Here is exactly how Sentry AI interacts with it:</p>
              <ul style={{ marginLeft: '20px', marginTop: '10px', lineHeight: '1.6' }}>
                <li><strong>Native OS/Browser Weights:</strong> Instead of Sentry AI downloading and parsing a massive 1.5GB compiled neural network file inside JavaScript memory (which often runs out of memory and crashes browser tabs on mobile devices), Chrome itself downloads, manages, and stores the model weights under <code>chrome://components</code>.</li>
                <li><strong>The Prompt API:</strong> Sentry AI leverages the experimental <code>window.ai.languageModel</code> API. Sentry AI passes the user prompt and context, and the browser executes the prediction using native optimized C++ code.</li>
                <li><strong>Direct NPU/GPU Acceleration:</strong> Chrome interacts directly with the system's Neural Processing Unit (NPU) or Graphics Processing Unit (GPU) via native platform frameworks (like DirectML on Windows, Vulkan on Linux/Android, or Metal on macOS). This bypasses the heavy web sandbox translation layer, yielding lightning-fast response speeds.</li>
                <li><strong>Dynamic Resource Allocator:</strong> The browser dynamically loads the model weights when Sentry AI initiates a chat session and unloads it if system memory becomes constrained, protecting your computer's responsiveness.</li>
              </ul>
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
        },
        {
          id: 'gemini-enable',
          icon: <Cpu size={18} className="text-cyan" />,
          title: "How do I enable the local Google Gemini Nano Engine?",
          content: (
            <>
              <p>Because Gemini Nano is currently an experimental browser standard, you must explicitly enable it in your browser flags:</p>
              <ol style={{ marginLeft: '20px', marginTop: '10px', lineHeight: '1.6' }}>
                <li>Open a new browser tab and navigate to <code style={{ color: 'var(--cyan)' }}>chrome://flags</code>.</li>
                <li>Search for <strong>"Prompt API for Gemini Nano"</strong> and set it to <strong>Enabled</strong>.</li>
                <li>Search for <strong>"Optimization Guide On Device Model"</strong> and set it to <strong>Enabled BypassPrefRequirement</strong>.</li>
                <li>Relaunch your browser, then open <code style={{ color: 'var(--cyan)' }}>chrome://components</code> and click <strong>"Check for update"</strong> on the <em>Optimization Guide On Device Model</em> to download the ~1.5 GB model files locally.</li>
              </ol>
              <p style={{ marginTop: '10px' }}>Once completed, Sentry AI will instantly verify compatibility and unlock the Gemini Nano engine on your setup page!</p>
            </>
          )
        },
        {
          id: 'gemini-mention-branding',
          icon: <HelpCircle size={18} className="text-amber" />,
          title: "Why does Sentry AI explicitly mention Google Chrome and Gemini Nano? What if I use Safari or Firefox?",
          content: (
            <>
              <p>Prominently identifying Google Chrome/Gemini Nano is a technical and UX design necessity for two critical reasons:</p>
              <ul style={{ marginLeft: '20px', marginTop: '10px', lineHeight: '1.6' }}>
                <li><strong>The Background Download Check:</strong> The first time you enable the native browser model, Chrome has to download a large model file (~1.5 GB to 4.7 GB depending on device specs and optimization components) in the background under <code>chrome://components</code>. If Sentry AI did not explicitly state this, you would experience a long loading delay without knowing that your browser is actively setting up the model.</li>
                <li><strong>Browser Compatibility Constraints:</strong> The native Prompt API standard is developed by Google and is currently only supported in Chromium-based browsers like Chrome, Microsoft Edge, and Brave. It does not work on Apple Safari or Mozilla Firefox.</li>
              </ul>
              <p style={{ marginTop: '10px' }}><strong>Sentry AI's Auto-Fallback:</strong> If you use Safari, Firefox, or are on an unsupported device, <strong>the application will not break!</strong> Sentry AI will automatically detect your environment and switch to a fully offline WebGPU or CPU-bound WebAssembly (WASM) model. While you lose the speed of Chrome's built-in engine, the core chat and security vault remain completely local and fully functional.</p>
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
        {/* Dynamic Gemini Nano Recommendation Banner */}
        {!checkingHardware && (
          <div style={{ animation: 'fade-in 0.5s ease-out' }}>
            {profile?.supportsGeminiNano ? (
              <div className="card" style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(6, 182, 212, 0.03) 100%)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                boxShadow: '0 8px 32px rgba(16, 185, 129, 0.05)',
                padding: '24px',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--emerald)'
                  }}>
                    <Sparkles size={22} style={{ animation: 'pulse-logo 2.5s ease-in-out infinite' }} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--emerald)', margin: 0 }}>
                      Google Gemini Nano is compatible and ready!
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px', margin: 0 }}>
                      Device Compatibility: Fully Supported (Natively Integrated)
                    </p>
                  </div>
                </div>
                <p style={{ fontSize: '0.92rem', lineHeight: 1.6, margin: 0, color: 'var(--text-secondary)' }}>
                  Excellent news! Sentry AI has detected that your browser natively supports Google's on-device AI. 
                  Gemini Nano executes locally on your hardware NPU/GPU with <strong>zero network calls and absolute privacy</strong>. 
                  Since it is built directly into Chrome, it starts instantly, consumes minimal memory, and runs completely offline. 
                  We highly recommend using Gemini Nano for a premium, fast, and fully secure offline experience.
                </p>
                <div>
                  <Link to="/" className="btn btn-cyan" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', borderRadius: '8px' }}>
                    Select Gemini Nano Engine
                  </Link>
                </div>
              </div>
            ) : isChromiumBrowser() ? (
              <div className="card" style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.06) 0%, rgba(99, 102, 241, 0.03) 100%)',
                border: '1px solid rgba(6, 182, 212, 0.2)',
                boxShadow: '0 8px 32px rgba(6, 182, 212, 0.05)',
                padding: '24px',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'rgba(6, 182, 212, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--cyan)'
                  }}>
                    <Cpu size={22} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--cyan)', margin: 0 }}>
                      Unlock Google Gemini Nano on this Device
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px', margin: 0 }}>
                      Device Compatibility: Compatible (Setup Required)
                    </p>
                  </div>
                </div>
                <p style={{ fontSize: '0.92rem', lineHeight: 1.6, margin: 0, color: 'var(--text-secondary)' }}>
                  You are using a Chromium browser (Chrome/Edge/Brave) that is compatible with Google's built-in <strong>Gemini Nano</strong> model, 
                  but the experimental browser Prompt API is not active. Enabling it will unlock a high-performance local AI engine running natively on your hardware, bypass general memory constraints, and preserve 100% offline privacy with zero external calls.
                </p>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button 
                    className="btn btn-cyan" 
                    onClick={() => setOpenAccordion('gemini-enable')}
                    style={{ padding: '10px 20px', fontSize: '0.85rem', fontWeight: 600, borderRadius: '8px' }}
                  >
                    View Enable Guide
                  </button>
                  <Link to="/" className="btn" style={{ padding: '10px 20px', fontSize: '0.85rem', fontWeight: 600, borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', textDecoration: 'none', color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center' }}>
                    Go to Setup Tab
                  </Link>
                </div>
              </div>
            ) : (
              <div className="card" style={{
                background: 'rgba(255, 255, 255, 0.01)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                padding: '24px',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)'
                  }}>
                    <AlertCircle size={22} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                      Interested in native on-device AI?
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px', margin: 0 }}>
                      Device Compatibility: Current Browser Unsupported
                    </p>
                  </div>
                </div>
                <p style={{ fontSize: '0.92rem', lineHeight: 1.6, margin: 0, color: 'var(--text-secondary)' }}>
                  Sentry AI supports Google's built-in <strong>Gemini Nano</strong> engine. Because it is part of the modern web platform standard, it requires a Chromium browser (Google Chrome or Microsoft Edge). 
                  To experience instant startup times, hardware NPU acceleration, and absolute local privacy with no downloads, we recommend opening Sentry AI in Google Chrome.
                </p>
              </div>
            )}
          </div>
        )}

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
