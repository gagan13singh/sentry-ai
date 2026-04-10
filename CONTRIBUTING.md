# Contributing to Sentry AI

Thanks for your interest in contributing. Here's everything you need to know.

## Getting Started

```bash
git clone https://github.com/gagan13singh/sentry-ai.git
cd sentry-ai
npm install
npm run dev
```

## Architecture — Read Before Contributing

Before making changes, read `src/workers/ai.worker.js` and `src/hooks/useModelManager.js` first. Most features touch these two files.

### Rule 1: COOP/COEP Headers Are Non-Negotiable
`vite.config.js` sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`. These are required for `SharedArrayBuffer` which WebLLM needs. Removing them silently breaks the GPU engine.

### Rule 2: Never Import AI Libraries on the Main Thread
`@mlc-ai/web-llm` and `@huggingface/transformers` must only be imported inside `src/workers/ai.worker.js`. Importing them in React components will block the UI and crash the tab.

### Rule 3: All AI Calls Go Through the Queue
Use `queueInference()` in the worker — never call `llmEngine` or `wasmEngine` directly. The queue prevents concurrent inference which crashes WebGPU contexts.

### Rule 4: No External Network Calls for Core Features
If your feature needs an external API, it needs a clear opt-in with a network audit warning. The privacy guarantee is the entire point of this project.

## How to Contribute

### Reporting Bugs
Open an issue with:
- Browser + version (e.g. Chrome 124)
- Device / GPU if known
- Console errors (F12 → Console tab)
- Steps to reproduce

### Adding Features
1. Open an issue describing the feature first
2. Fork the repo
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Make changes
5. Run `npm run lint` and `npm run build` — both must pass
6. Open a PR with description of what changed and why

### Good First Issues
- Adding prompt templates to `src/lib/promptTemplates.js`
- Adding threat detection patterns to `src/hooks/useThreatDetector.js`
- Improving mobile layout in `src/pages/pages.css`
- Writing tests for utility functions in `src/lib/`

## Code Style
- No TypeScript (intentionally — keeps contribution barrier low)
- All stateful logic in hooks (`src/hooks/`)
- Comment non-obvious decisions — see existing code for style
- No additional UI libraries beyond lucide-react

## Questions?
Open an issue tagged `question`.