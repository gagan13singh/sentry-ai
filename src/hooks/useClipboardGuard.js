// ================================================================
// useClipboardGuard.js
// FIXED: result was referenced before guardPaste returned (temporal dead zone).
//        The onBlocked callback now receives { cleaned, threats } directly
//        instead of trying to close over `result`.
// ================================================================

import { useCallback, useState } from 'react';

const CLIPBOARD_THREATS = [
    { name: 'Zero-Width Chars', pattern: /[\u200B-\u200D\uFEFF\u00AD]/, severity: 'high' },
    { name: 'RTL Override', pattern: /[\u202E\u202D\u200F]/, severity: 'critical' },
    { name: 'Homograph Attack', pattern: /[\u0430\u043E\u0440\u0441\u0435\u0456\u0458\u04CF]/, severity: 'high' },
    { name: 'Hidden Instruction', pattern: /\x00|\x01|\x02|\x03|\x1B/, severity: 'high' },
    { name: 'Prompt Injection', pattern: /ignore.{0,20}(previous|prior|above)\s+instructions?/i, severity: 'critical' },
    { name: 'System Impersonation', pattern: /\[SYSTEM\]|\[ASSISTANT\]|\[INST\]/i, severity: 'high' },
];

function stripHiddenChars(text) {
    return text
        .replace(/[\u200B-\u200D\uFEFF\u00AD\u202E\u202D\u200F]/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
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