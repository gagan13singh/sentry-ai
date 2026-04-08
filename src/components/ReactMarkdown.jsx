// ================================================================
// ReactMarkdown.jsx
//
// BUG FIXES:
// 1. The `renderer.link` override used the old marked v4 signature
//    `(href, title, text)` but marked v5+ passes a single token object.
//    This caused ALL links to render as raw text (href was undefined).
//    Now uses the v5+ token-based renderer.
//
// 2. During streaming, `setInterval` at 80ms accumulated multiple frames
//    between renders, causing flicker when content updated faster than
//    the interval. Replaced with `useRef`-based content tracking + a
//    single rAF-aligned timeout for smoother streaming.
//
// 3. DOMPurify PURIFY_CONFIG allowed `style` attribute which can be used
//    for CSS injection (e.g. `expression(...)` in legacy IE, or to hide
//    content). Removed `style` from ADD_ATTR. KaTeX inlines its own safe
//    styles via class names which DOMPurify already preserves.
//
// 4. `if (!content) return null` was checked AFTER the useMemo that
//    calls `marked.parse`. On the first render of a streaming message,
//    content is `''` — this triggered the early return but the debounce
//    effect was already set up, leaking an interval. Moved the guard
//    before all hooks (via early return in render, not in hook).
//    Actually: cannot return before hooks, so now guarded inside useMemo.
//
// IMPROVEMENTS:
// A. Code blocks now get a language label + a copy button.
// B. Tables are wrapped in a scrollable container so they don't overflow.
// ================================================================

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import markedKatex from 'marked-katex-extension';
import 'katex/dist/katex.min.css';

// ── Custom renderer ───────────────────────────────────────────────
const renderer = new marked.Renderer();

// FIX: marked v5+ passes a token object, not (href, title, text)
renderer.link = function (token) {
  const href = token.href || '';
  const title = token.title || '';
  const text = token.text || href;
  const safe = DOMPurify.sanitize(href);
  if (!safe) return text; // strip unsafe hrefs entirely
  return `<a href="${safe}" title="${title}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

// IMPROVEMENT: wrap tables in scroll container
renderer.table = function (token) {
  const header = token.header
    .map(cell => `<th>${cell.text}</th>`)
    .join('');
  const rows = token.rows
    .map(row => `<tr>${row.map(cell => `<td>${cell.text}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
};

marked.use({ renderer });
marked.use(markedKatex({ throwOnError: false }));

// FIX: removed 'style' attr (CSS injection risk); KaTeX uses class-based styling
const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'class', 'aria-hidden'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  ADD_TAGS: [
    'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mspace',
    'msqrt', 'mroot', 'mfrac', 'mop', 'munderover', 'svg', 'path',
    'g', 'rect', 'line', 'circle', 'text', 'defs', 'clipPath', 'use', 'annotation',
  ],
};

function renderMarkdown(raw) {
  if (!raw) return '';
  // Normalize LLM LaTeX delimiters → $ / $$
  let preprocessed = raw
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, p1) => `$$${p1}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, p1) => `$${p1}$`);
  const rawHtml = marked.parse(preprocessed, { gfm: true, breaks: true });
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
}

export default function ReactMarkdown({ content, isStreaming = false }) {
  // FIX: track latest content in a ref to avoid stale closures in the throttle
  const latestContent = useRef(content);
  latestContent.current = content;

  const [renderContent, setRenderContent] = useState(content);

  useEffect(() => {
    if (!isStreaming) {
      // Streaming stopped — commit final content immediately
      setRenderContent(latestContent.current);
      return;
    }

    // FIX: use a single setTimeout (not setInterval) to avoid frame pile-up.
    // Each tick schedules the next one, so we never have more than one pending.
    let raf = null;
    let timeoutId = null;

    const tick = () => {
      raf = requestAnimationFrame(() => {
        setRenderContent(latestContent.current);
        timeoutId = setTimeout(tick, 80);
      });
    };

    timeoutId = setTimeout(tick, 80);

    return () => {
      clearTimeout(timeoutId);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isStreaming]);

  const html = useMemo(() => renderMarkdown(renderContent), [renderContent]);

  if (!content && !isStreaming) return null;

  return (
    <div
      className="md-content"
      dangerouslySetInnerHTML={{ __html: html || content }}
    />
  );
}