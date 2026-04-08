// ================================================================
// useKnowledgeAugment.js
// IMPROVED: Better recency detection patterns
//           Added dismissWarning export (used by Chat.jsx)
//           Fixed overly-broad HISTORICAL_SAFE patterns that were
//           suppressing warnings for queries that genuinely need
//           recent data (e.g. "explain who the current CEO is")
// ================================================================

import { useCallback, useState } from 'react';

// Patterns that signal post-training-cutoff knowledge is needed
const RECENCY_PATTERNS = [
    /\b(2025|2026)\b/,
    /\b(latest|newest|recent|current|now|today|this year|this week|this month|right now|as of)\b/i,
    /\b(just (announced|released|launched|happened|dropped)|breaking|update[ds]?|new version)\b/i,
    /\b(gpt-5|gemini 2|claude 4|llama 4|iphone 1[6-9]|android 1[5-9]|windows 1[2-9])\b/i,
    /\b(stock price|share price|market cap|crypto price|\bbtc\b|\beth\b)\b/i,
    /\b(current (president|pm|prime minister|ceo|cto|head of)|who (is|runs|leads) (the |a )?(president|ceo|government))\b/i,
    /\b(news|headlines|trending)\b/i,
];

// FIXED: Narrowed to only patterns that are unambiguously historical.
// Removed "explain|what is|how does" because those phrasing patterns
// can still be used to ask about current events (e.g. "what is the
// current state of X", "how does the new Y work").
const HISTORICAL_SAFE = [
    /\b(history of|invented in|founded in|born in|died in|war of|revolution of)\b/i,
    /\b(19[0-9]{2}|20[0-1][0-9]|202[0-3])\b/, // years up to 2023 are safe
    /\b(ancient|medieval|classical|prehistoric|historical|century)\b/i,
    /\b(theorem|formula|equation|definition of|meaning of|concept of)\b/i,
];

export function useKnowledgeAugment() {
    const [cutoffWarning, setCutoffWarning] = useState(null);

    const analyzeQuery = useCallback((text) => {
        if (!text || text.length < 8) return { needsWarning: false };

        // Must match a safe pattern AND not match any recency pattern
        const isSafe = HISTORICAL_SAFE.some(p => p.test(text)) &&
            !RECENCY_PATTERNS.some(p => p.test(text));
        if (isSafe) return { needsWarning: false };

        const matched = RECENCY_PATTERNS.find(p => p.test(text));
        if (!matched) return { needsWarning: false };

        return {
            needsWarning: true,
            reason: 'This question may need information from after my training cutoff. I\'ll answer from what I know, but verify anything time-sensitive.',
        };
    }, []);

    const buildCutoffContext = useCallback((ragContextAvailable) => {
        if (ragContextAvailable) {
            return `\n\n## Knowledge Context
Your training data has a cutoff. The user has provided relevant documents in the vault context above — use that information to answer questions about recent events. If the vault context doesn't cover the question, clearly say: "My training data has a cutoff. For the latest information, you can paste relevant text into the vault or directly into this chat."`;
        }
        return `\n\n## Knowledge Cutoff Notice
Your training data has a cutoff date. If this question requires more recent information, be transparent: say exactly what you know up to your cutoff and clearly note that you may not have the latest data. Do NOT fabricate recent events, statistics, or updates.`;
    }, []);

    const showCutoffWarning = useCallback((reason) => {
        setCutoffWarning(reason);
        setTimeout(() => setCutoffWarning(null), 8000);
    }, []);

    const dismissWarning = useCallback(() => setCutoffWarning(null), []);

    return { analyzeQuery, buildCutoffContext, cutoffWarning, showCutoffWarning, dismissWarning };
}