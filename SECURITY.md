# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| Latest (main branch) | ✅ |

## What the Security Model Covers

Sentry AI's entire value is privacy and security. Here is what is in and out of scope.

### In Scope
- **Data exfiltration** — any way prompts, documents, or conversations could reach an external server
- **Prompt injection** — attacks causing the AI to reveal system prompts or behave maliciously
- **XSS via markdown rendering** — DOMPurify is used but misconfiguration matters
- **Clipboard injection** — malicious content injected via paste events (RTL override, zero-width chars)
- **Service worker bypass** — ways to circumvent the network blocking logic
- **Cryptographic weaknesses** — issues with AES-256-GCM conversation encryption

### Out of Scope
- AI model output quality (hallucinations, bias) — known limitation of local LLMs
- Model weight integrity — we do not control HuggingFace/MLC CDNs
- Browser security bugs — report those to the browser vendor

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

If you find something — especially anything that could cause user data to leave the device unexpectedly:

1. Email: gagan13singh@[your-email-domain]
2. Include: description, steps to reproduce, potential impact
3. Allow 7 days for an initial response before public disclosure

Valid, significant reports will be credited in the fix commit.

## Known Limitations

- **Model weights download from external CDNs** (HuggingFace, MLC) on first load. This is unavoidable and logged transparently in the Privacy Audit as "expected external" calls.
- **Air-Gap mode** blocks further downloads but cannot verify integrity of already-downloaded weights.
- **pdfjs-dist worker** loads from `cdn.jsdelivr.net` — logged in Privacy Audit as a known CDN asset.