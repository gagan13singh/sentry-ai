// ================================================================
// ReactMarkdown.jsx — Robust markdown renderer for chat
// Uses marked + dompurify to handle streaming partial markdown correctly
// ================================================================

import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export default function ReactMarkdown({ content }) {
  const html = useMemo(() => {
    if (!content) return '';

    // Parse markdown into HTML with gfm and line breaks
    // marked natively handles unclosed code blocks during stream generation
    const rawHtml = marked.parse(content, { gfm: true, breaks: true });

    // Sanitize output to prevent XSS payload execution
    return DOMPurify.sanitize(rawHtml);
  }, [content]);

  if (!content) return null;
  return <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
