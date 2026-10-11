// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Gestion des clés X25519 de l'utilisateur (complément à `mediaEncryption`,
 * qui gère la pile P-256 historique).
 *
 * Modèle de clés — identique à la pile P-256, mais colonnes et emplacement
 * IndexedDB dédiés pour cohabiter sans casser l'existant :
 *   • clé publique  → profiles.x25519_public_key  (taguée `x25519:`)
 *   • clé privée    → IndexedDB local, ET copie chiffrée par mot de passe
 *                     dans user_key_material.x25519_private_key / _salt / _iv
 *                     (table propriétaire, RLS `user_id = auth.uid()`).
 *
 * Objectif : permettre au chiffrement du texte d'utiliser X25519 quand les
 * deux parties l'ont, avec **repli automatique** sur P-256 sinon. Aucune
 * donnée existante n'est invalidée.
 */

import { supabase } from './supabase';
import {
  isX25519PublicKey,
  tagX25519,
  signX25519PublicKey,
  verifyX25519PublicKeySignature,
  type X25519KeyPair,
} from './x25519';
import { getLocalRatchetKeys } from './ratchet/keyStore';
import type { SigningKeyPair } from './ratchet/x3dh';
import { sealAtRest, openAtRest } from './atRestCrypto';

const IDB_NAME = 'nephtys-e2ee';
const IDB_STORE = 'private-keys';
const IDB_KEY_PREFIX = 'x25519-private-key-v1';

// ─── IndexedDB ────────────────────────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<X25519KeyPair | undefined> {
  const db = await openIdb();
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // Déchiffre le matériel au repos (ou lit l'ancien format en clair).
  return (await openAtRest(raw)) as X25519KeyPair | undefined;
}

async function idbSet(key: string, value: X25519KeyPair): Promise<void> {
  const db = await openIdb();
  const stored = await sealAtRest(value);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(stored, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function idbKeyFor(userId: string): string {
  return `${IDB_KEY_PREFIX}:${userId}`;
}

// ─── Lecture locale (pas de réseau) ───────────────────────────────────

/**
 * Récupère la paire X25519 locale du user si présente en IndexedDB.
 * Retourne `null` sinon (l'appelant doit alors retomber sur P-256).
 */
export async function getLocalX25519KeyPair(userId: string): Promise<X25519KeyPair | null> {
  try {
    const cached = await idbGet(idbKeyFor(userId));
    if (!cached?.privateKey || !cached?.publicKey) return null;
    return { publicKey: tagX25519(cached.publicKey), privateKey: cached.privateKey };
  } catch {
    return null;
  }
}

// ─── Clés publiques distantes ─────────────────────────────────────────

const PIN_PREFIX = 'nephtys_x25519_pin_';

interface KeyPin { signer: string; key: string }

function readPin(peerId: string): KeyPin | null {
  try {
    const raw = localStorage.getItem(PIN_PREFIX + peerId);
    return raw ? (JSON.parse(raw) as KeyPin) : null;
  } catch {
    return null;
  }
}

function writePin(peerId: string, pin: KeyPin): void {
  try {
    localStorage.setItem(PIN_PREFIX + peerId, JSON.stringify(pin));
  } catch {
    // quota / localStorage indisponible → pas de pinning
  }
}

function notify(event: string, detail: unknown): void {
  try {
    window.dispatchEvent(new CustomEvent(event, { detail }));
  } catch {
    // pas de window (SSR/tests)
  }
}

/**
 * Récupère les clés publiques X25519 publiées d'un ensemble d'utilisateurs,
 * en les AUTHENTIFIANT :
 *   • si une signature Ed25519 est publiée → elle DOIT vérifier (sinon la clé
 *     est rejetée : un serveur qui la substituerait serait détecté) ;
 *   • sinon (clé historique non signée) → TOFU (confiance à la 1re vue) avec
 *     détection de changement (event `nephtys:x25519-key-change`).
 * La clé de signature est elle-même pinnée (TOFU) : un changement d'émetteur
 * déclenche `nephtys:x25519-signer-change`.
 */
export async function fetchX25519PublicKeys(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, x25519_public_key, x25519_public_key_sig, x25519_signing_key, ratchet_signing_key')
    .in('id', userIds)
    .not('x25519_public_key', 'is', null);
  if (error) {
    // Migration non appliquée → aucune clé X25519, repli côté appelant.
    return map;
  }
  (data ?? []).forEach((p: any) => {
    const key: string | undefined = p.x25519_public_key;
    if (!isX25519PublicKey(key)) return;

    const sig: string | undefined = p.x25519_public_key_sig ?? undefined;
    const signer: string | undefined = p.x25519_signing_key || p.ratchet_signing_key || undefined;

    if (sig && signer) {
      if (!verifyX25519PublicKeySignature(signer, key!, sig)) {
        // Signature invalide → clé possiblement substituée : on REJETTE.
        console.warn('[e2ee] signature X25519 invalide pour', p.id);
        notify('nephtys:x25519-sig-invalid', { peerId: p.id });
        return;
      }
      const pin = readPin(p.id);
      if (pin && pin.signer && pin.signer !== signer) {
        console.warn('[e2ee] clé de signature X25519 changée pour', p.id);
        notify('nephtys:x25519-signer-change', { peerId: p.id, oldSigner: pin.signer, newSigner: signer });
      }
      writePin(p.id, { signer, key: key! });
      map.set(p.id, key!);
    } else {
      // Clé historique non signée → TOFU.
      const pin = readPin(p.id);
      if (pin && pin.key !== key) {
        console.warn('[e2ee] clé X25519 (non signée) changée pour', p.id);
        notify('nephtys:x25519-key-change', { peerId: p.id, oldKey: pin.key, newKey: key });
      }
      writePin(p.id, { signer: pin?.signer ?? '', key: key! });
      map.set(p.id, key!);
    }
  });
  return map;
}

// ─── Cycle de vie de la paire (install / clear) ───────────────────────

/**
 * Installe une paire X25519 DÉJÀ DÉRIVÉE (récupération par phrase) : stockage
 * local + publication de la clé publique. **Aucune copie chiffrée serveur**
 * (modèle « zéro serveur »).
 *
 * Si `signing` est fourni (clé de signature dérivée de la même phrase), on
 * publie aussi la SIGNATURE Ed25519 de la clé X25519 + la clé publique de
 * signature : les pairs peuvent alors AUTHENTIFIER la clé (anti-MITM).
 */
export async function installX25519KeyPair(
  userId: string,
  keyPair: X25519KeyPair,
  signing?: SigningKeyPair,
): Promise<void> {
  const update: Record<string, unknown> = {
    x25519_public_key: keyPair.publicKey,
    x25519_public_key_updated_at: new Date().toISOString(),
  };
  if (signing?.privateKey) {
    update.x25519_public_key_sig = signX25519PublicKey(signing.privateKey, keyPair.publicKey);
    update.x25519_signing_key = signing.publicKey;
  }
  const { error } = await supabase.from('profiles').update(update).eq('id', userId);
  if (error) throw error;
  await idbSet(idbKeyFor(userId), keyPair);
}

/**
 * Publie (best-effort) la signature de la clé X25519 locale déjà installée, à
 * partir de la clé de signature ratchet locale. Permet d'authentifier les clés
 * existantes SANS rotation. Renvoie `true` si la mise à jour a réussi.
 */
export async function publishX25519Signature(userId: string): Promise<boolean> {
  const [local, ratchet] = await Promise.all([
    getLocalX25519KeyPair(userId),
    getLocalRatchetKeys(userId),
  ]);
  const signing = ratchet?.signingKeyPair;
  if (!local?.publicKey || !signing?.privateKey) return false;
  const { error } = await supabase
    .from('profiles')
    .update({
      x25519_public_key: local.publicKey,
      x25519_public_key_sig: signX25519PublicKey(signing.privateKey, local.publicKey),
      x25519_signing_key: signing.publicKey,
    })
    .eq('id', userId);
  return !error;
}

/** Efface la paire X25519 locale (aucun stockage serveur). */
export async function clearLocalX25519(userId: string): Promise<void> {
  await idbDelete(idbKeyFor(userId));
}

