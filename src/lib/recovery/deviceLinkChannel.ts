// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Liaison d'appareil « façon WhatsApp Web » — **le bon sens**.
 *
 *   • L'appareil NON connecté (page de connexion) **affiche un QR** : il crée un
 *     canal (file anonyme) + une paire X25519 éphémère. Le QR contient
 *     `{queueId, sendToken, ephemeralPublicKey}` (aucun secret de compte).
 *   • L'appareil DÉJÀ connecté **scanne ce QR** et **envoie** la session +
 *     la phrase, chiffrées pour la clé éphémère (le serveur ne peut pas lire).
 *   • L'appareil non connecté **récupère**, déchiffre, établit la session et
 *     installe les clés → il est connecté.
 *
 * Le secret n'est donc JAMAIS dans le QR : il transite chiffré via le relais.
 */

import { supabase } from '../supabase';
import {
  generateX25519KeyPair,
  wrapKeyForRecipientX25519,
  unwrapKeyFromSenderX25519,
} from '../x25519';
import { installKeysFromPhrase, getStoredRecoveryPhrase } from './recoveryService';

const AES: AesKeyAlgorithm = { name: 'AES-GCM', length: 256 };

export interface LinkRequest {
  /** Chaîne à mettre dans le QR (le nouvel appareil l'affiche). */
  payload: string;
  /** Interroge le canal ; renvoie la session+phrase quand l'appareil connecté l'a rempli. */
  poll: () => Promise<{ accessToken: string; refreshToken: string; phrase: string } | null>;
}

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function unb64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface QrPayload {
  q: string; // queueId
  s: string; // sendToken
  e: string; // clé publique éphémère du nouvel appareil
}

/** Étape 1 (appareil NON connecté) : crée le canal + le QR. */
export async function createLinkRequest(): Promise<LinkRequest> {
  const { data, error } = await supabase.rpc('anon_queue_create');
  if (error || !data) throw new Error(error?.message ?? 'Canal indisponible.');
  const creds = data as { queueId: string; sendToken: string; rcvToken: string };
  const eph = generateX25519KeyPair();
  const payload = JSON.stringify({ q: creds.queueId, s: creds.sendToken, e: eph.publicKey } as QrPayload);

  const poll = async (): Promise<{ accessToken: string; refreshToken: string; phrase: string } | null> => {
    const { data: read } = await supabase.rpc('anon_queue_read', {
      p_queue_id: creds.queueId,
      p_rcv_token: creds.rcvToken,
      p_limit: 1,
    });
    const rows = (read as { messages?: Array<{ id: string; ciphertext: string }> } | null)?.messages ?? [];
    for (const row of rows) {
      try {
        const envelope = JSON.parse(row.ciphertext) as {
          w: { encryptedKey: string; iv: string; senderPublicKey: string };
          iv: string;
          ct: string;
        };
        const rawKey = await unwrapKeyFromSenderX25519(
          { encryptedKey: envelope.w.encryptedKey, iv: envelope.w.iv, senderPublicKey: envelope.w.senderPublicKey },
          eph.privateKey,
        );
        const key = await crypto.subtle.importKey('raw', rawKey, AES, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: unb64(envelope.iv) },
          key,
          unb64(envelope.ct),
        );
        const inner = JSON.parse(new TextDecoder().decode(plain)) as {
          at: string;
          rt: string;
          p: string;
        };
        await supabase.rpc('anon_queue_ack', { p_queue_id: creds.queueId, p_rcv_token: creds.rcvToken, p_ids: [row.id] });
        return { accessToken: inner.at, refreshToken: inner.rt, phrase: inner.p };
      } catch {
        // pas encore rempli / pas pour nous → on réessaiera
      }
    }
    return null;
  };

  return { payload, poll };
}

/** Étape 2 (appareil DÉJÀ connecté) : remplit le canal avec session + phrase. */
export async function fulfillLinkRequest(scanned: string): Promise<void> {
  const qr = JSON.parse(scanned) as QrPayload;
  if (!qr.q || !qr.s || !qr.e) throw new Error('QR code non reconnu.');

  const phrase = getStoredRecoveryPhrase();
  if (!phrase) throw new Error('Phrase locale absente : reconnectez-vous une fois.');
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token || !session?.refresh_token) throw new Error('Session active requise.');

  // Chiffrement pour la clé éphémère du nouvel appareil (le serveur ne lit rien).
  const aesKey = await crypto.subtle.generateKey(AES, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const inner = new TextEncoder().encode(
    JSON.stringify({ at: session.access_token, rt: session.refresh_token, p: phrase }),
  );
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, inner));
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));

  const sender = generateX25519KeyPair();
  const wrapped = await wrapKeyForRecipientX25519(rawKey, sender.privateKey, sender.publicKey, qr.e);

  const envelope = JSON.stringify({ w: wrapped, iv: b64(iv), ct: b64(ct) });
  const { error } = await supabase.rpc('anon_queue_send', {
    p_queue_id: qr.q,
    p_send_token: qr.s,
    p_ciphertext: envelope,
  });
  if (error) throw new Error(error.message);
}

/** Étape 3 (appareil NON connecté) : applique la session + les clés reçues. */
export async function applyLinkResponse(res: {
  accessToken: string;
  refreshToken: string;
  phrase: string;
}): Promise<void> {
  const { data, error } = await supabase.auth.setSession({
    access_token: res.accessToken,
    refresh_token: res.refreshToken,
  });
  if (error || !data.session?.user) throw new Error(error?.message ?? 'Session invalide.');
  await installKeysFromPhrase(data.session.user.id, res.phrase);
}