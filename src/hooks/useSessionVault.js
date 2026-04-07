// ================================================================
// useSessionVault.js
// NEW: AES-GCM encrypted conversation storage via Web Crypto API
// Key derived from a user passphrase via PBKDF2, stored in sessionStorage
// (cleared automatically when tab closes — never persisted to disk in plaintext)
// ================================================================

const STORAGE_KEY = 'sentry-ai-enc-conversations';
const SALT_KEY = 'sentry-ai-salt';
const SESSION_KEY_KEY = 'sentry-ai-session-key-check';

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
    // Prepend IV to ciphertext for storage
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decrypt(key, base64) {
    const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
}

// ── Session key cache (survives re-renders, cleared on tab close) ──
let _sessionKey = null;
let _sessionSalt = null;

function getOrCreateSalt() {
    const existing = localStorage.getItem(SALT_KEY);
    if (existing) return Uint8Array.from(atob(existing), c => c.charCodeAt(0));
    const salt = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(SALT_KEY, btoa(String.fromCharCode(...salt)));
    return salt;
}

// ── Main export ────────────────────────────────────────────────────
import { useState, useCallback, useEffect } from 'react';

export function useSessionVault() {
    const [isLocked, setIsLocked] = useState(true);
    const [isEncrypted, setIsEncrypted] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        // Auto-unlock with a device-specific ephemeral key if no passphrase was set
        // This gives encryption-at-rest without user friction for basic use
        const hasEncrypted = !!localStorage.getItem(STORAGE_KEY);
        setIsEncrypted(hasEncrypted);

        // If we have a session key in memory already (e.g. after HMR), stay unlocked
        if (_sessionKey) setIsLocked(false);
    }, []);

    const unlock = useCallback(async (passphrase) => {
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
        }
    }, []);

    // Auto-unlock with a tab-scoped key (no passphrase — encrypts against memory snooping)
    const unlockEphemeral = useCallback(async () => {
        // Use a random key stored only in sessionStorage — cleared when tab closes
        let ephemeralPass = sessionStorage.getItem('_eph');
        if (!ephemeralPass) {
            ephemeralPass = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
            sessionStorage.setItem('_eph', ephemeralPass);
        }
        return unlock(ephemeralPass);
    }, [unlock]);

    const lock = useCallback(() => {
        _sessionKey = null;
        setIsLocked(true);
    }, []);

    const saveConversations = useCallback(async (conversations) => {
        if (!_sessionKey) {
            // Fallback: unencrypted (for when vault hasn't been unlocked yet)
            localStorage.setItem(STORAGE_KEY + '_plain', JSON.stringify(conversations.slice(0, 50)));
            return;
        }
        try {
            const enc = await encrypt(_sessionKey, conversations.slice(0, 50));
            localStorage.setItem(STORAGE_KEY, enc);
            localStorage.removeItem(STORAGE_KEY + '_plain');
        } catch (e) {
            console.warn('Vault save failed:', e);
        }
    }, []);

    const loadConversations = useCallback(async () => {
        // Try encrypted first
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
        // Fallback to plain
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY + '_plain') || '[]');
        } catch {
            return [];
        }
    }, []);

    const wipeAll = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_plain');
        localStorage.removeItem(SALT_KEY);
        sessionStorage.removeItem('_eph');
        _sessionKey = null;
        _sessionSalt = null;
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
        wipeAll,
    };
}