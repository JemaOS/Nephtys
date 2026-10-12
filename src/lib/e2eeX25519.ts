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
import { openAtRest, sealAtRestStrict } from './atRestCrypto';

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
  // Matériel de CLÉS → chiffrement STRICT : si le chiffrement au repos est
  // indisponible, on échoue plutôt que d'écrire la clé privée en clair.
  const stored = await sealAtRestStrict(value);
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

/** Raison d'un changement de clé refusé, en attente de vérification hors-bande. */
export type PendingKeyChangeReason = 'signer-change' | 'key-change' | 'unsigned-downgrade';

export interface PendingKeyChange {
  signer: string;
  key: string;
  reason: PendingKeyChangeReason;
  at: string;
}

interface KeyPin {
  signer: string;
  key: string;
  /** Clé refusée, conservée pour confirmation/rejet explicite (hors-bande). */
  pending?: PendingKeyChange;
}

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

/** Marque une clé refusée comme « à vérifier », SANS écraser la clé de confiance. */
function flagPending(peerId: string, pin: KeyPin, change: PendingKeyChange): void {
  writePin(peerId, { signer: pin.signer, key: pin.key, pending: change });
}

/**
 * État de vérification d'un pair : expose une éventuelle clé refusée en attente
 * de confirmation (à afficher côté UI, ex. via le safety number).
 */
export function getX25519PendingKeyChange(peerId: string): PendingKeyChange | null {
  return readPin(peerId)?.pending ?? null;
}

/**
 * Confirme un changement de clé après vérification hors-bande : la clé en
 * attente devient la clé de confiance (pin mis à jour).
 */
export function confirmX25519KeyChange(peerId: string): boolean {
  const pin = readPin(peerId);
  if (!pin?.pending) return false;
  writePin(peerId, { signer: pin.pending.signer, key: pin.pending.key });
  return true;
}

/** Rejette un changement en attente : la clé de confiance reste inchangée. */
export function rejectX25519KeyChange(peerId: string): void {
  const pin = readPin(peerId);
  if (!pin) return;
  writePin(peerId, { signer: pin.signer, key: pin.key });
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
 *   • sinon (clé historique non signée) → TOFU (confiance à la 1re vue).
 *
 * FAIL-CLOSED (durci) : un **changement** de clé au regard du pin n'est plus
 * accepté silencieusement. On conserve le pin de confiance et on REFUSE la
 * nouvelle clé pour la session (elle n'est pas renvoyée dans la map) :
 *   • signataire pinné qui change → `nephtys:x25519-signer-change` ;
 *   • clé non signée qui change → `nephtys:x25519-key-change` ;
 *   • clé authentifiée remplacée par une clé NON signée (downgrade) → refus.
 * Un événement `nephtys:x25519-key-pending-verification` est émis et la clé
 * refusée est exposée via `getX25519PendingKeyChange` / `confirmX25519KeyChange`.
 * Le PREMIER contact (aucun pin) reste autorisé (TOFU initial).
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

    const pin = readPin(p.id);
    const trustedSigner = pin?.signer ?? '';
    const keyChanged = !!pin && pin.key !== key;

    if (sig && signer) {
      // La signature est liée au COMPTE (`p.id`) : recopier le tuple
      // (clé+sig+signataire) d'Alice dans la ligne de Bob échoue ici.
      if (!verifyX25519PublicKeySignature(signer, key!, sig, p.id)) {
        // Signature invalide → clé possiblement substituée : on REJETTE.
        console.warn('[e2ee] signature X25519 invalide pour', p.id);
        notify('nephtys:x25519-sig-invalid', { peerId: p.id });
        return;
      }
      // Signataire pinné qui change, OU rotation d'une clé jusque-là non signée
      // par un signataire inconnu → non vérifié → on REFUSE (fail-closed).
      if (trustedSigner && trustedSigner !== signer) {
        console.warn('[e2ee] clé de signature X25519 changée pour', p.id);
        flagPending(p.id, pin!, { signer, key: key!, reason: 'signer-change', at: new Date().toISOString() });
        notify('nephtys:x25519-signer-change', { peerId: p.id, oldSigner: trustedSigner, newSigner: signer });
        notify('nephtys:x25519-key-pending-verification', { peerId: p.id, reason: 'signer-change' });
        return;
      }
      if (keyChanged && trustedSigner !== signer) {
        console.warn('[e2ee] clé X25519 changée (signataire non pinné) pour', p.id);
        flagPending(p.id, pin!, { signer, key: key!, reason: 'key-change', at: new Date().toISOString() });
        notify('nephtys:x25519-key-change', { peerId: p.id, oldKey: pin!.key, newKey: key });
        notify('nephtys:x25519-key-pending-verification', { peerId: p.id, reason: 'key-change' });
        return;
      }
      // Signataire de confiance identique → rotation légitime autorisée par le
      // signataire pinné, ou premier contact TOFU → on accepte (et on pinne).
      writePin(p.id, { signer, key: key! });
      map.set(p.id, key!);
    } else {
      // Clé non signée (ou partie signature absente).
      if (trustedSigner && !signer) {
        // Downgrade : un pair authentifié publie désormais une clé non signée.
        // Si la clé est identique, l'identité n'a pas changé : on conserve le
        // pin signé et on renvoie la clé (pas de régression). Sinon on REFUSE.
        if (!keyChanged) {
          map.set(p.id, pin!.key);
          return;
        }
        console.warn('[e2ee] clé X25519 non signée après authentification pour', p.id);
        flagPending(p.id, pin!, { signer: '', key: key!, reason: 'unsigned-downgrade', at: new Date().toISOString() });
        notify('nephtys:x25519-key-change', { peerId: p.id, oldKey: pin!.key, newKey: key });
        notify('nephtys:x25519-key-pending-verification', { peerId: p.id, reason: 'unsigned-downgrade' });
        return;
      }
      if (keyChanged) {
        // Clé non signée qui change sans authentification → refus, pin conservé.
        console.warn('[e2ee] clé X25519 (non signée) changée pour', p.id);
        flagPending(p.id, pin!, { signer: pin!.signer ?? '', key: key!, reason: 'key-change', at: new Date().toISOString() });
        notify('nephtys:x25519-key-change', { peerId: p.id, oldKey: pin!.key, newKey: key });
        notify('nephtys:x25519-key-pending-verification', { peerId: p.id, reason: 'key-change' });
        return;
      }
      // Premier contact (TOFU) autorisé.
      writePin(p.id, { signer: trustedSigner, key: key! });
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
    update.x25519_public_key_sig = signX25519PublicKey(signing.privateKey, keyPair.publicKey, userId);
    update.x25519_signing_key = signing.publicKey;
  }
  // Stockage local D'ABORD (chiffrement au repos strict : échec explicite) pour
  // ne jamais publier une clé publique sans la clé privée correspondante.
  await idbSet(idbKeyFor(userId), keyPair);
  const { error } = await supabase.from('profiles').update(update).eq('id', userId);
  if (error) throw error;
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
      x25519_public_key_sig: signX25519PublicKey(signing.privateKey, local.publicKey, userId),
      x25519_signing_key: signing.publicKey,
    })
    .eq('id', userId);
  return !error;
}

/** Efface la paire X25519 locale (aucun stockage serveur). */
export async function clearLocalX25519(userId: string): Promise<void> {
  await idbDelete(idbKeyFor(userId));
}

