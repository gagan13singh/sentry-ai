// ================================================================
// useSessionVault.js
//
// BUG FIXES:
// 1. Module-level `_sessionKey` / `_sessionSalt` are shared across ALL
//    component instances (e.g. if the hook is used in both Chat and Audit).
//    This was already intentional for the session-key cache, but there was
//    a race condition: if two components mounted simultaneously and both
//    called `unlockEphemeral`, two PBKDF2 derivations ran and the second
//    one silently overwrote the first.  Added an in-flight promise guard.
//
// 2. `saveConversations` called `slice(0, 50)` but did NOT check whether
//    the argument was an array — if passed `undefined` or `null` it threw
//    a silent TypeError.  Now defensive.
//
// 3. `getOrCreateSalt` did `localStorage.getItem` — this is synchronous
//    and fine, but if localStorage is unavailable (e.g. private browsing
//    with strict settings in Safari), it threw an uncaught exception that
//    silently broke the entire vault.  Now wrapped in try/catch with a
//    fallback to an in-memory salt.
//
// 4. `decrypt` used `Uint8Array.from(atob(base64), ...)` which breaks on
//    base64 strings that contain newlines (some older storages added them).
//    Now strips whitespace before decoding.
//
// IMPROVEMENTS:
// A. Added `changePassphrase()` — re-encrypts all stored data under a new key.
// B. `wipeAll` now also removes the legacy `_plain` storage key.
// ================================================================

import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'sentry-ai-enc-conversations';
const SALT_KEY = 'sentry-ai-salt';

// ── Crypto helpers ─────────────────────────────────────────────────
async function deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey(
        'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
        keyMat,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encrypt(key, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(JSON.stringify(data))
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decrypt(key, base64) {
    // FIX: strip whitespace that some browsers insert into base64 localStorage values
    const cleaned = base64.replace(/\s/g, '');
    const combined = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
}

// ── Session key cache ──────────────────────────────────────────────
let _sessionKey = null;
let _sessionSalt = null;
let _unlockInFlight = null; // FIX: prevent concurrent unlock races

// FIX: wrapped in try/catch — localStorage may be blocked in strict private mode
function getOrCreateSalt() {
    try {
        const existing = localStorage.getItem(SALT_KEY);
        if (existing) return Uint8Array.from(atob(existing), c => c.charCodeAt(0));
        const salt = crypto.getRandomValues(new Uint8Array(32));
        localStorage.setItem(SALT_KEY, btoa(String.fromCharCode(...salt)));
        return salt;
    } catch {
        // Fallback: in-memory salt (won't persist across tabs, but won't crash)
        if (!_sessionSalt) _sessionSalt = crypto.getRandomValues(new Uint8Array(32));
        return _sessionSalt;
    }
}

// ── Main export ────────────────────────────────────────────────────
export function useSessionVault() {
    const [isLocked, setIsLocked] = useState(true);
    const [isEncrypted, setIsEncrypted] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        try {
            const hasEncrypted = !!localStorage.getItem(STORAGE_KEY);
            setIsEncrypted(hasEncrypted);
        } catch { /* localStorage unavailable */ }
        if (_sessionKey) setIsLocked(false);
    }, []);

    const unlock = useCallback(async (passphrase) => {
        // FIX: if unlock is already in progress, return the same promise
        if (_unlockInFlight) return _unlockInFlight;

        _unlockInFlight = (async () => {
            try {
                const salt = getOrCreateSalt();
                _sessionKey = await deriveKey(passphrase, salt);
                _sessionSalt = salt;
                setIsLocked(false);
                setError(null);
                return true;
            } catch (e) {
                setError('Failed to unlock vault: ' + e.message);
                return false;
            } finally {
                _unlockInFlight = null;
            }
        })();

        return _unlockInFlight;
    }, []);

    const unlockEphemeral = useCallback(async () => {
        // Already unlocked — skip expensive PBKDF2
        if (_sessionKey) {
            setIsLocked(false);
            return true;
        }
        let ephemeralPass;
        try {
            ephemeralPass = sessionStorage.getItem('_eph');
            if (!ephemeralPass) {
                ephemeralPass = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
                sessionStorage.setItem('_eph', ephemeralPass);
            }
        } catch {
            // sessionStorage unavailable — use a random in-memory passphrase
            ephemeralPass = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
        }
        return unlock(ephemeralPass);
    }, [unlock]);

    const lock = useCallback(() => {
        _sessionKey = null;
        setIsLocked(true);
    }, []);

    const saveConversations = useCallback(async (conversations) => {
        // FIX: guard against null/undefined argument
        if (!Array.isArray(conversations)) return;

        const data = conversations.slice(0, 50);

        if (!_sessionKey) {
            try {
                localStorage.setItem(STORAGE_KEY + '_plain', JSON.stringify(data));
            } catch { /* quota exceeded */ }
            return;
        }
        try {
            const enc = await encrypt(_sessionKey, data);
            localStorage.setItem(STORAGE_KEY, enc);
            localStorage.removeItem(STORAGE_KEY + '_plain');
        } catch (e) {
            console.warn('Vault save failed:', e);
        }
    }, []);

    const loadConversations = useCallback(async () => {
        const enc = localStorage.getItem(STORAGE_KEY);
        if (enc && _sessionKey) {
            try {
                return await decrypt(_sessionKey, enc);
            } catch (e) {
                console.warn('Vault decrypt failed (wrong key?):', e);
                setError('Could not decrypt conversations. Wrong passphrase?');
                return [];
            }
        }
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY + '_plain') || '[]');
        } catch {
            return [];
        }
    }, []);

    // IMPROVEMENT: re-encrypt existing data under a new passphrase
    const changePassphrase = useCallback(async (newPassphrase) => {
        if (!_sessionKey) return false;
        try {
            const existing = await loadConversations();
            const salt = getOrCreateSalt();
            const newKey = await deriveKey(newPassphrase, salt);
            _sessionKey = newKey;
            await saveConversations(existing);
            return true;
        } catch (e) {
            setError('Failed to change passphrase: ' + e.message);
            return false;
        }
    }, [loadConversations, saveConversations]);

    const wipeAll = useCallback(() => {
        try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STORAGE_KEY + '_plain');
            localStorage.removeItem(SALT_KEY);
            sessionStorage.removeItem('_eph');
        } catch { /* ignore */ }
        _sessionKey = null;
        _sessionSalt = null;
        _unlockInFlight = null;
        setIsLocked(true);
        setIsEncrypted(false);
    }, []);

    return {
        isLocked,
        isEncrypted,
        error,
        unlock,
        unlockEphemeral,
        lock,
        saveConversations,
        loadConversations,
        changePassphrase,
        wipeAll,
    };
}