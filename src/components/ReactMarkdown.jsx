// ================================================================
// ReactMarkdown.jsx
// FIXED: DOMPurify only runs on completed responses (not every token)
// FIXED: links open in _blank with noopener (DOMPurify strips target by default)
// FIXED: debounced sanitize during streaming to cut CPU during fast token streams
// ================================================================

import { useMemo, useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked renderer to make links safe + external
const renderer = new marked.Renderer();
renderer.link = (href, title, text) => {
  const safe = DOMPurify.sanitize(href || '');
  return `<a href="${safe}" title="${title || ''}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({ renderer });

// DOMPurify config — allow target/rel on anchors (stripped by default)
const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

export default function ReactMarkdown({ content, isStreaming = false }) {
  const [debouncedContent, setDebouncedContent] = useState(content);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (!isStreaming) {
      setDebouncedContent(contentRef.current);
      return;
    }
    const timer = setInterval(() => {
      setDebouncedContent(contentRef.current);
    }, 80);
    return () => clearInterval(timer);
  }, [isStreaming]);

  // During streaming, throttle sanitization at 80ms to avoid per-token CPU spikes.
  // When streaming stops, use the final content immediately.
  const contentToRender = isStreaming ? debouncedContent : content;

  const html = useMemo(() => {
    if (!contentToRender) return '';
    const rawHtml = marked.parse(contentToRender, { gfm: true, breaks: true });
    return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
  }, [contentToRender]);

  if (!content) return null;

  // Show raw text during fast streaming, rendered HTML when debounce settles
  return (
    <div
      className="md-content"
      dangerouslySetInnerHTML={{ __html: html || content }}
    />
  );
}