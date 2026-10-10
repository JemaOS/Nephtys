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
import { fetchKeyMaterial, upsertKeyMaterial } from './keyMaterial';
import {
    encryptPrivateKeyRaw,
    decryptPrivateKeyRaw,
    type EncryptedPrivateKey,
} from './passphraseCrypto';
import { workerEncrypt, workerDecrypt } from './passphraseWorker';

export type { EncryptedPrivateKey };

/**
 * Chiffre une clé privée ECDH (PKCS8 base64) avec une passphrase.
 * Exécuté dans un Web Worker si disponible (UI non figée pendant les 310k
 * itérations PBKDF2), sinon repli sur le thread principal.
 */
export async function encryptPrivateKeyWithPassphrase(
    privateKeyPkcs8Base64: string,
    passphrase: string,
): Promise<EncryptedPrivateKey> {
    const viaWorker = workerEncrypt(privateKeyPkcs8Base64, passphrase);
    if (viaWorker) {
        try {
            return await viaWorker;
        } catch (err) {
            if ((err as Error)?.name !== 'WorkerUnavailable') throw err;
        }
    }
    return encryptPrivateKeyRaw(privateKeyPkcs8Base64, passphrase);
}

/**
 * Déchiffre une clé privée chiffrée avec la passphrase.
 * Throws si la passphrase est incorrecte (AES-GCM lève une exception).
 * Exécuté dans un Web Worker si disponible, sinon repli local.
 */
export async function decryptPrivateKeyWithPassphrase(
    encrypted: EncryptedPrivateKey,
    passphrase: string,
): Promise<string /* PKCS8 base64 */> {
    const viaWorker = workerDecrypt(encrypted, passphrase);
    if (viaWorker) {
        try {
            return await viaWorker;
        } catch (err) {
            if ((err as Error)?.name !== 'WorkerUnavailable') throw err;
        }
    }
    return decryptPrivateKeyRaw(encrypted, passphrase);
}

// ─── Sauvegarde / chargement DB ───────────────────────────────────────

export async function uploadEncryptedPrivateKey(
    userId: string,
    enc: EncryptedPrivateKey,
): Promise<void> {
    await upsertKeyMaterial(userId, {
        encrypted_private_key: enc.encryptedPrivateKey,
        private_key_salt: enc.salt,
        private_key_iv: enc.iv,
    });
    const { error } = await supabase
        .from('profiles')
        .update({ public_key_updated_at: new Date().toISOString() })
        .eq('id', userId);
    if (error) throw error;
}

export async function fetchEncryptedPrivateKey(
    userId: string,
): Promise<EncryptedPrivateKey | null> {
    const keyMat = await fetchKeyMaterial(userId);
    if (!keyMat?.encrypted_private_key || !keyMat.private_key_salt || !keyMat.private_key_iv) {
        return null;
    }
    return {
        encryptedPrivateKey: keyMat.encrypted_private_key,
        salt: keyMat.private_key_salt,
        iv: keyMat.private_key_iv,
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
    return { score: score as PassphraseStrength['score'], label: labels[score], ok: p.length >= 4 };
}
