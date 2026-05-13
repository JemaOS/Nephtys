// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Passphrase-based key recovery (style Signal/Telegram).
 *
 * Permet de chiffrer la clé privée ECDH avec une passphrase utilisateur,
 * puis de la stocker en DB. Sur un nouveau device, on demande la passphrase,
 * on dérive la clé, on déchiffre la privée localement.
 *
 * - PBKDF2-SHA256 avec 310 000 itérations (recommandation OWASP 2024)
 * - Sel aléatoire 16 octets unique par utilisateur
 * - AES-GCM 256 bits avec IV aléatoire 12 octets
 *
 * L'admin de la DB ne peut PAS déchiffrer la clé privée sans la passphrase.
 */

import { supabase } from './supabase';

const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

const ECDH_PARAMS: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' };

// ─── Helpers base64 ───────────────────────────────────────────────────

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

// ─── Dérivation de la clé de chiffrement à partir de la passphrase ────

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveKey'],
    );
    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations: PBKDF2_ITERATIONS,
            hash: PBKDF2_HASH,
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

// ─── Chiffrement de la clé privée avec la passphrase ──────────────────

export interface EncryptedPrivateKey {
    encryptedPrivateKey: string; // base64
    salt: string;                // base64 (16 bytes)
    iv: string;                  // base64 (12 bytes)
}

/**
 * Chiffre une clé privée ECDH (PKCS8 base64) avec une passphrase.
 * Génère sel et IV aléatoires.
 */
export async function encryptPrivateKeyWithPassphrase(
    privateKeyPkcs8Base64: string,
    passphrase: string,
): Promise<EncryptedPrivateKey> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    const aesKey = await deriveKeyFromPassphrase(passphrase, salt);
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        aesKey,
        base64ToBuf(privateKeyPkcs8Base64),
    );

    return {
        encryptedPrivateKey: bufToBase64(encrypted),
        salt: bufToBase64(salt.buffer as ArrayBuffer),
        iv: bufToBase64(iv.buffer as ArrayBuffer),
    };
}

/**
 * Déchiffre une clé privée chiffrée avec la passphrase.
 * Throws si la passphrase est incorrecte (AES-GCM lève une exception).
 */
export async function decryptPrivateKeyWithPassphrase(
    encrypted: EncryptedPrivateKey,
    passphrase: string,
): Promise<string /* PKCS8 base64 */> {
    const salt = new Uint8Array(base64ToBuf(encrypted.salt));
    const iv = new Uint8Array(base64ToBuf(encrypted.iv));

    const aesKey = await deriveKeyFromPassphrase(passphrase, salt);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        aesKey,
        base64ToBuf(encrypted.encryptedPrivateKey),
    );
    return bufToBase64(decrypted);
}

// ─── Sauvegarde / chargement DB ───────────────────────────────────────

export async function uploadEncryptedPrivateKey(
    userId: string,
    enc: EncryptedPrivateKey,
): Promise<void> {
    const { error } = await supabase
        .from('profiles')
        .update({
            encrypted_private_key: enc.encryptedPrivateKey,
            private_key_salt: enc.salt,
            private_key_iv: enc.iv,
            public_key_updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    if (error) throw error;
}

export async function fetchEncryptedPrivateKey(
    userId: string,
): Promise<EncryptedPrivateKey | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('encrypted_private_key, private_key_salt, private_key_iv')
        .eq('id', userId)
        .maybeSingle();
    if (error || !data) return null;
    if (!data.encrypted_private_key || !data.private_key_salt || !data.private_key_iv) {
        return null;
    }
    return {
        encryptedPrivateKey: data.encrypted_private_key,
        salt: data.private_key_salt,
        iv: data.private_key_iv,
    };
}

// ─── Validation passphrase ────────────────────────────────────────────

export interface PassphraseStrength {
    score: 0 | 1 | 2 | 3 | 4;
    label: string;
    ok: boolean;
}

export function checkPassphraseStrength(p: string): PassphraseStrength {
    if (!p || p.length < 4) {
        return { score: 0, label: 'Trop courte (4 caractères minimum)', ok: false };
    }
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^a-zA-Z0-9]/.test(p)) score++;
    score = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;

    const labels = ['Très faible', 'Faible', 'Acceptable', 'Forte', 'Très forte'];
    return { score, label: labels[score], ok: p.length >= 4 };
}
