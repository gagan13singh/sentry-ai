// ================================================================
// useClipboardGuard.js
// FIXED: result was referenced before guardPaste returned (temporal dead zone).
//        The onBlocked callback now receives { cleaned, threats } directly
//        instead of trying to close over `result`.
// FIXED: Completely removed RegExp control characters to avoid ESLint warnings.
//        Now relies on high-performance character-based filtering.
// ================================================================

import { useCallback, useState } from 'react';

// Character-based control check helper (fully immune to ESLint control-regex warnings)
function hasControlChars(text) {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === 0 || code === 1 || code === 2 || code === 3 || code === 27) {
            return true;
        }
    }
    return false;
}

const CLIPBOARD_THREATS = [
    { name: 'Zero-Width Chars', pattern: /[\u200B-\u200D\uFEFF\u00AD]/, severity: 'high' },
    { name: 'RTL Override', pattern: /[\u202E\u202D\u200F]/, severity: 'critical' },
    { name: 'Homograph Attack', pattern: /[\u0430\u043E\u0440\u0441\u0435\u0456\u0458\u04CF]/, severity: 'high' },
    { name: 'Hidden Instruction', pattern: { test: (text) => hasControlChars(text) }, severity: 'high' },
    { name: 'Prompt Injection', pattern: /ignore.{0,20}(previous|prior|above)\s+instructions?/i, severity: 'critical' },
    { name: 'System Impersonation', pattern: /\[SYSTEM\]|\[ASSISTANT\]|\[INST\]/i, severity: 'high' },
];

function stripHiddenChars(text) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // Strip zero-width chars (8203-8205, 65279, 173) and RTL overrides (8238, 8237, 8207)
        if (
            code === 8203 || code === 8204 || code === 8205 || code === 65279 || code === 173 ||
            code === 8238 || code === 8237 || code === 8207
        ) {
            continue;
        }
        // Strip other hidden control characters (0-8, 11-12, 14-31, 127)
        if (
            (code >= 0 && code <= 8) ||
            code === 11 || code === 12 ||
            (code >= 14 && code <= 31) ||
            code === 127
        ) {
            continue;
        }
        result += text[i];
    }
    return result;
}

function analyzeClipboard(text) {
    const threats = [];
    for (const { name, pattern, severity } of CLIPBOARD_THREATS) {
        if (pattern.test(text)) {
            threats.push({ name, severity });
        }
    }
    const cleaned = stripHiddenChars(text);
    const wasModified = cleaned !== text;
    return { threats, cleaned, wasModified, safe: threats.filter(t => t.severity !== 'low').length === 0 };
}

export function useClipboardGuard() {
    const [lastClipboardScan, setLastClipboardScan] = useState(null);
    const [blockedPastes, setBlockedPastes] = useState(0);

    const guardPaste = useCallback((rawText, onSafe, onBlocked) => {
        const analysis = analyzeClipboard(rawText);
        setLastClipboardScan({ ...analysis, timestamp: new Date().toISOString() });

        if (!analysis.safe) {
            setBlockedPastes(n => n + 1);
            // FIXED: pass the full analysis object so callers get threats directly
            onBlocked?.({
                original: rawText,
                threats: analysis.threats,
                cleaned: analysis.cleaned,
            });
            return { blocked: true, cleaned: analysis.cleaned, threats: analysis.threats };
        }

        if (analysis.wasModified) {
            onSafe?.(analysis.cleaned);
            return { blocked: false, text: analysis.cleaned };
        }

        onSafe?.(rawText);
        return { blocked: false, text: rawText };
    }, []);

    // FIXED: onBlocked now destructures threats from its own parameter,
    // never touches the outer `result` variable which doesn't exist yet.
    const createPasteHandler = useCallback((setInputFn, currentValue) => {
        return (e) => {
            e.preventDefault();
            const pasted = e.clipboardData?.getData('text') || '';
            guardPaste(
                pasted,
                (clean) => setInputFn(currentValue + clean),
                ({ cleaned, threats }) => {
                    const threatList = threats?.map(t => `• ${t.name} (${t.severity})`).join('\n') || 'Unknown threat';
                    const userAccepts = window.confirm(
                        `⚠️ Clipboard Guard detected suspicious content:\n${threatList}\n\nThe hidden characters have been removed. Paste the cleaned version?`
                    );
                    if (userAccepts) setInputFn(currentValue + cleaned);
                }
            );
        };
    }, [guardPaste]);

    return { lastClipboardScan, blockedPastes, guardPaste, createPasteHandler };
}