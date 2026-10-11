// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Liaison d'appareil « façon WhatsApp Web ».
 *
 * L'appareil DÉJÀ connecté (A) affiche un QR qui contient :
 *   • la phrase de récupération (clés E2EE), et
 *   • la session (access/refresh tokens) — pour que l'appareil B soit connecté
 *     sans ressaisir le mot de passe.
 * L'appareil B (nouveau) SCANNE le QR → il établit la session + installe les
 * clés → tout est accessible.
 *
 * ⚠️ Le QR donne un ACCÈS COMPLET au compte : ne le montrer qu'à un appareil de
 * confiance (même principe que le QR WhatsApp Web). Il est compressé pour tenir
 * dans un QR code.
 */

import { supabase } from '../supabase';
import { installKeysFromPhrase, getStoredRecoveryPhrase } from './recoveryService';
import { deflate, inflate } from 'pako';

const PREFIX = 'NEPHTYS-DEVICE1:';

interface DevicePayload {
  p: string; // phrase de récupération
  at: string; // access token
  rt: string; // refresh token
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function fromB64Url(value: string): Uint8Array {
  let b64 = value.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function encodePayload(p: DevicePayload): string {
  return PREFIX + toB64Url(deflate(new TextEncoder().encode(JSON.stringify(p)), { level: 9 }));
}
function decodePayload(link: string): DevicePayload {
  const trimmed = link.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error('QR code non reconnu.');
  const out = inflate(fromB64Url(trimmed.slice(PREFIX.length)));
  return JSON.parse(new TextDecoder().decode(out)) as DevicePayload;
}

/** Vrai si le texte ressemble à un lien d'appareil Nephtys. */
export function isDeviceLink(link: string): boolean {
  return link.trim().startsWith(PREFIX);
}

/**
 * Crée le lien/QR sur l'appareil DÉJÀ connecté (A). Lève si la session ou la
 * phrase locale est absente.
 */
export async function createDeviceLink(): Promise<string> {
  const phrase = getStoredRecoveryPhrase();
  if (!phrase) {
    throw new Error('Phrase locale absente : reconnectez-vous une fois pour pouvoir afficher ce code.');
  }
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error('Session active requise pour générer le code.');
  }
  return encodePayload({ p: phrase, at: session.access_token, rt: session.refresh_token });
}

/**
 * Lie l'appareil COURANT (B) à partir d'un QR scanné : établit la session puis
 * installe les clés. Renvoie l'identifiant utilisateur lié.
 */
export async function redeemDeviceLink(link: string): Promise<string> {
  const payload = decodePayload(link);
  const { data, error } = await supabase.auth.setSession({
    access_token: payload.at,
    refresh_token: payload.rt,
  });
  if (error || !data.session?.user) {
    throw new Error(error?.message ?? 'Session invalide ou expirée.');
  }
  const userId = data.session.user.id;
  await installKeysFromPhrase(userId, payload.p);
  return userId;
}