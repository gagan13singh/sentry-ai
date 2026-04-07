// ================================================================
// useKnowledgeAugment.js
// Solves the Llama 3.2 knowledge cutoff problem without compromising privacy.
//
// APPROACH: The model knows up to early 2024. For queries about recent
// events/data, we can't send them to the cloud (privacy). Instead:
//
// 1. DETECT: Pattern-match queries that likely need post-2024 knowledge
// 2. SURFACE: Show the user a non-blocking hint with options
// 3. INJECT: If user pastes/provides context, inject it into the RAG system
// 4. HONEST: Always prepend a "knowledge cutoff" disclaimer when relevant
//
// This is the correct local-AI approach — we never call external APIs.
// The user retains full control over what context gets added.
// ================================================================

import { useCallback, useState } from 'react';

// ── Patterns that signal "recent / post-2024 knowledge needed" ────
const RECENCY_PATTERNS = [
    // Explicit year references
    /\b(2024|2025|2026)\b/,
    // "latest", "recent", "current", "now", "today", "this year"
    /\b(latest|newest|recent|current|now|today|this year|this week|this month|right now|as of)\b/i,
    // News/events language
    /\b(just (announced|released|launched|happened|dropped)|breaking|update[ds]?|new version)\b/i,
    // Product/tech releases
    /\b(gpt-5|gemini|claude 4|llama 4|iphone 1[6-9]|android 1[5-9]|windows 1[2-9])\b/i,
    // Stock/price queries
    /\b(stock price|share price|market cap|crypto price|btc|eth)\b/i,
    // Current office holders
    /\b(current (president|pm|prime minister|ceo|cto|head of)|who (is|runs|leads) (the |a )?(president|ceo|government))\b/i,
];

// ── Queries that are clearly historical (no warning needed) ────────
const HISTORICAL_SAFE = [
    /\b(history of|invented in|founded in|born in|died in|war of|revolution of)\b/i,
    /\b(19[0-9]{2}|20[0-1][0-9]|202[0-3])\b/, // years up to 2023 are "safe"
    /\b(explain|what is|how does|definition|meaning of|concept of|theory of)\b/i,
];

export function useKnowledgeAugment() {
    const [cutoffWarning, setCutoffWarning] = useState(null);

    // Returns { needsWarning, reason } for a given user message
    const analyzeQuery = useCallback((text) => {
        if (!text || text.length < 8) return { needsWarning: false };

        // If it matches a safe historical pattern, skip
        if (HISTORICAL_SAFE.some(p => p.test(text))) return { needsWarning: false };

        const matched = RECENCY_PATTERNS.find(p => p.test(text));
        if (!matched) return { needsWarning: false };

        return {
            needsWarning: true,
            reason: 'This question may need information after early 2024 (the model\'s knowledge cutoff).',
        };
    }, []);

    // Build a system prompt addition that honestly communicates the limitation
    // and tells the model to use any RAG context injected by the user
    const buildCutoffContext = useCallback((ragContextAvailable) => {
        if (ragContextAvailable) {
            return `\n\n## Knowledge Context
Your training data ends in early 2024. The user has provided relevant documents in the vault context above — use that information to answer questions about recent events. If the vault context doesn't cover the question, clearly say: "My training data ends in early 2024. For the latest information, you can paste relevant text into the vault or directly into this chat."`;
        }
        return `\n\n## Knowledge Cutoff Notice
Your training data ends in early 2024. If this question requires more recent information, be transparent: say exactly what you know up to your cutoff and clearly note that you may not have the latest data. Do NOT fabricate recent events, statistics, or updates.`;
    }, []);

    const showCutoffWarning = useCallback((reason) => {
        setCutoffWarning(reason);
        setTimeout(() => setCutoffWarning(null), 8000);
    }, []);

    const dismissWarning = useCallback(() => setCutoffWarning(null), []);

    return { analyzeQuery, buildCutoffContext, cutoffWarning, showCutoffWarning, dismissWarning };
}