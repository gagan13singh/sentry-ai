// ================================================================
// useThreatDetector.js
// NEW: Real-time threat detection for all chat inputs
// Detects: prompt injection, jailbreak attempts, PII patterns,
//          encoded attacks (base64, unicode), clipboard injection
// All detection is 100% LOCAL — no external calls
// ================================================================

import { useState, useCallback, useRef } from 'react';

// ── Pattern-based fast scanner (runs before AI model) ─────────────
// These catch common attacks in microseconds without needing the LLM.

const INJECTION_PATTERNS = [
    // Classic prompt injection
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|context)/i,
    /disregard\s+(your|all|previous)\s+(instructions?|training|guidelines)/i,
    /you\s+(are|were|must)\s+now\s+(a|an)\s+/i,
    /new\s+(system\s+)?prompt[:：]/i,
    /\[SYSTEM\]/i,
    /\<\|im_start\|\>/i,
    /\<\|im_end\|\>/i,
    /\<\|system\|\>/i,
    /###\s*instruction/i,
    /\/\*\s*system:/i,
    // DAN / jailbreak
    /do\s+anything\s+now/i,
    /pretend\s+(you\s+)?(are|have\s+no)\s+(restrictions?|limitations?|filters?)/i,
    /in\s+this\s+hypothetical\s+(world|scenario|universe)/i,
    /act\s+as\s+(if\s+you\s+(are|were)\s+)?(an?\s+)?(unrestricted|unfiltered|evil|jailbroken)/i,
    /developer\s+mode\s*(enabled|on|activated)/i,
    /jailbreak/i,
    // Data exfiltration attempts
    /print\s+(your\s+)?(system\s+)?prompt/i,
    /reveal\s+(your\s+)?(system\s+|hidden\s+|secret\s+)?instructions/i,
    /what\s+(are|were)\s+your\s+(initial|original|system)\s+(instructions?|prompt)/i,
    /repeat\s+(the\s+)?(words\s+)?above\s+starting\s+with/i,
    // Encoding tricks
    /base64\s*:\s*[A-Za-z0-9+/]{20,}/i,
];

const JAILBREAK_UNICODE = [
    /[\u202E\u200F\u200B\u2028\u2029]/,  // RTL override, zero-width chars
    /\u0000/,                              // null bytes
];

// PII patterns — detect before sending to LLM to warn user
const PII_PATTERNS = [
    { name: 'SSN', pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/ },
    { name: 'Credit Card', pattern: /\b(?:\d[ -]?){13,16}\b/ },
    { name: 'Email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
    { name: 'Phone', pattern: /\b(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
    { name: 'API Key', pattern: /\b(sk-|pk-|AIza|AKIA)[A-Za-z0-9]{20,}\b/ },
    { name: 'Private Key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/ },
    { name: 'Password', pattern: /password\s*[:=]\s*\S{6,}/i },
];

// ── Heuristic scorer ───────────────────────────────────────────────
function calculateThreatScore(text) {
    let score = 0;
    const threats = [];

    // Pattern scan
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(text)) {
            score += 40;
            threats.push({ type: 'prompt_injection', match: pattern.toString().slice(1, 30) });
            break; // one is enough to flag
        }
    }

    // Unicode tricks
    for (const pattern of JAILBREAK_UNICODE) {
        if (pattern.test(text)) {
            score += 60;
            threats.push({ type: 'unicode_trick', match: 'suspicious unicode characters' });
        }
    }

    // Excessive length with technical keywords (prompt stuffing)
    if (text.length > 3000) {
        const techKeywords = (text.match(/\b(system|assistant|user|prompt|instruction|role|context)\b/gi) || []).length;
        if (techKeywords > 8) {
            score += 25;
            threats.push({ type: 'prompt_stuffing', match: `${techKeywords} control keywords in long message` });
        }
    }

    // PII detection
    const piiFound = [];
    for (const { name, pattern } of PII_PATTERNS) {
        if (pattern.test(text)) {
            piiFound.push(name);
        }
    }
    if (piiFound.length > 0) {
        threats.push({ type: 'pii_detected', match: piiFound.join(', '), severity: 'warning' });
        // PII itself isn't a threat TO the model, it's a warning to the USER
        // Don't add to score, just surface it
    }

    return { score: Math.min(score, 100), threats, piiFound };
}

// ── Hook ───────────────────────────────────────────────────────────
export function useThreatDetector(onThreatDetected) {
    const [lastScan, setLastScan] = useState(null);
    const [isScanning, setIsScanning] = useState(false);
    const [threatLog, setThreatLog] = useState([]);
    const scanCountRef = useRef(0);

    const scanInput = useCallback(async (text, modelScanFn = null) => {
        if (!text || text.length < 10) return { safe: true, score: 0 };

        setIsScanning(true);
        scanCountRef.current++;

        // Phase 1: Pattern scan (instant)
        const { score, threats, piiFound } = calculateThreatScore(text);

        let result = {
            safe: score < 30,
            score,
            threats,
            piiFound,
            scanId: scanCountRef.current,
            timestamp: new Date().toISOString(),
            phase: 'pattern',
        };

        // Phase 2: AI model scan (only if pattern scan is ambiguous AND model is ready)
        if (score >= 20 && score < 60 && modelScanFn) {
            try {
                const aiResult = await modelScanFn(text);
                if (!aiResult.safe) {
                    result = {
                        ...result,
                        safe: false,
                        score: Math.max(score, 70),
                        aiVerified: true,
                        aiCategory: aiResult.category,
                        phase: 'ai_verified',
                    };
                }
            } catch (_) {
                // AI scan failed — fall back to pattern result
            }
        }

        setLastScan(result);
        setIsScanning(false);

        if (!result.safe || result.piiFound.length > 0) {
            setThreatLog(prev => [result, ...prev].slice(0, 50));
            onThreatDetected?.(result);
        }

        return result;
    }, [onThreatDetected]);

    const clearLog = useCallback(() => setThreatLog([]), []);

    return { lastScan, isScanning, threatLog, scanInput, clearLog, scanCount: scanCountRef.current };
}