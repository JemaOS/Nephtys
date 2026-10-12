// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.
//
// Client XFTP (transfert de fichiers) — s'appuie sur le client web XFTP vendoré
// (protocole XFTP v1‑v3 sur **HTTP/2 + TLS**, ALPN `xftp/1`).
//
// Le navigateur fait du HTTP/2 nativement via `fetch` → **aucun pont requis**
// pour XFTP (contrairement à SMP). Le serveur ne voit que des blocs chiffrés :
// la clé du fichier (end‑to‑end) voyage dans la **description**, transmise hors
// bande (dans un message SMP chiffré).

import {
  connectBrowserXftpWebClient,
  uploadXftpWebFile,
  downloadXftpWebFile,
} from '../smpweb/browser-xftp-web-client.mjs';
import { isTorRelayEnabled } from './relayClient';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Serveurs de fichiers XFTP proposés (adresse `xftp://<keyHash>@hôte`). */
export const XFTP_SERVER_PRESETS: string[] = [
  'xftp://da1aH3nOT-9G8lV7bWamhxpDYdJ1xmW7j3JpGaDR5Ug@xftp1.simplex.im',
  'xftp://5vog2Imy1ExJB_7zDZrkV1KDWi96jYFyy9CL6fndBVw@xftp2.simplex.im',
  'xftp://PYa32DdYNFWi0uZZOprWQoQpIk5qyjRJ3EF7bVpbsn8@xftp3.simplex.im',
  'xftp://k_GgQl40UZVV0Y4BX9ZTyMVqX5ZewcLW0waQIl7AYDE@xftp4.simplex.im',
  'xftp://-bIo6o8wuVc4wpZkZD3tH-rCeYaeER_0lz1ffQcSJDs@xftp5.simplex.im',
  'xftp://6nSvtY9pJn6PXWTAIMNl95E1Kk1vD7FM2TeOA64CFLg@xftp6.simplex.im',
];

export interface XftpUploadResult {
  /** Description destinée au destinataire (à transmettre hors bande). */
  recipientDescription: any;
  /** Description de l'expéditeur (pour suppression). */
  senderDescription: any;
  size: number;
}

/** Parse une adresse `xftp://[keyHash@]host[:port]`. */
function parseAddress(address: string): { host: string; keyHash?: Uint8Array; url: string } {
  const m = /^xftp:\/\/(?:([^@/]+)@)?([^/:]+)(?::(\d+))?/.exec(address.trim());
  if (!m) throw new Error('Adresse XFTP invalide.');
  const [, keyHashB64, host, port] = m;
  const keyHash = keyHashB64
    ? Uint8Array.from(atob(keyHashB64.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
    : undefined;
  return { host, keyHash, url: `https://${host}${port ? ':' + port : ''}` };
}

/**
 * Hôte (minuscule) d'une adresse XFTP, `''` si l'adresse est invalide.
 * Exposé pour que l'UI puisse afficher la destination AVANT tout téléchargement.
 */
export function xftpServerHost(address: string): string {
  try {
    return parseAddress(address).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Hôtes XFTP explicitement de confiance : presets officiels + serveur configuré
 * localement (`VITE_XFTP_SERVER` / localStorage). Le serveur local est de
 * confiance car c'est l'utilisateur qui l'a choisi (jamais le pair).
 */
function trustedXftpHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const address of [...XFTP_SERVER_PRESETS, getXftpFileServer()]) {
    const host = xftpServerHost(address);
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * Vrai si `address` désigne un serveur XFTP **de confiance**. Un descripteur
 * XFTP reçu d'un pair est une donnée NON fiable : son champ `server` ne doit
 * jamais pouvoir viser un hôte arbitraire, sinon un pair malveillant force la
 * victime à se connecter à son serveur → **fuite de l'adresse IP** (tracking).
 *
 * On n'accepte donc que :
 *   • les hôtes des presets officiels (`XFTP_SERVER_PRESETS`) ;
 *   • l'hôte du serveur XFTP configuré localement ;
 *   • tout hôte sous `simplex.im` (serveurs XFTP de l'écosystème SimpleX).
 */
export function isAllowedXftpServer(address: string): boolean {
  const host = xftpServerHost(address);
  if (!host) return false;
  if (host === 'simplex.im' || host.endsWith('.simplex.im')) return true;
  return trustedXftpHosts().has(host);
}

/** Lève une erreur si `address` n'est pas un serveur XFTP de confiance. */
export function assertAllowedXftpServer(address: string): void {
  if (isAllowedXftpServer(address)) return;
  const host = xftpServerHost(address);
  throw new Error(
    `serveur XFTP refusé${host ? ` (${host})` : ''} : ce n’est pas un serveur XFTP connu. ` +
    'Un descripteur reçu d’un pair ne peut pas désigner un hôte arbitraire ' +
    '(protection contre la fuite d’adresse IP).',
  );
}

/** Se connecte à un serveur XFTP (handshake HTTP/2 + identité vérifiée). */
export async function connectXftp(address: string): Promise<any> {
  // 1) `desc.server` (pair-contrôlé) doit pointer un serveur XFTP connu, sans
  //    quoi aucun `fetch` n'est tenté (anti-fuite d'IP).
  assertAllowedXftpServer(address);
  // 2) Tor actif ⇒ un `fetch` XFTP direct révélerait l'IP au serveur XFTP. Aucun
  //    transport XFTP via Tor n'est câblé/vérifiable côté client : on refuse
  //    (fail-closed) au lieu de fuir l'IP en clair.
  if (isTorRelayEnabled()) {
    throw new Error(
      'transfert XFTP refusé : Tor est actif et aucun transport XFTP via Tor n’est ' +
      'disponible (un transfert direct révélerait votre adresse IP au serveur). ' +
      'Désactivez Tor pour échanger des fichiers.',
    );
  }
  const { keyHash, url } = parseAddress(address);
  return await connectBrowserXftpWebClient({ url, keyHash });
}

/** Envoie un fichier vers le serveur XFTP ; renvoie les descriptions. */
export async function uploadFileToXftp(
  address: string,
  data: Uint8Array,
  fileName: string,
): Promise<XftpUploadResult> {
  const client = await connectXftp(address);
  const up: any = await uploadXftpWebFile(client, data, { fileName });
  return {
    recipientDescription: up.recipientDescription,
    senderDescription: up.senderDescription,
    size: up.encryptedSize ?? data.length,
  };
}

/** Télécharge un fichier depuis une description reçue. */
export async function downloadFileFromXftp(address: string, description: any): Promise<Uint8Array> {
  const client = await connectXftp(address);
  const dl: any = await downloadXftpWebFile(client, description);
  return dl instanceof Uint8Array ? dl : (dl.content ?? dl.data);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Préférences (serveur de fichiers) ────────────────────────────────

const XFTP_SERVER_KEY = 'nephtys_xftp_file_server';

/** Serveur de fichiers XFTP sélectionné (défaut = premier preset). */
export function getXftpFileServer(): string {
  try {
    const o = localStorage.getItem(XFTP_SERVER_KEY);
    if (o) return o;
  } catch {
    // localStorage indisponible
  }
  return (import.meta.env.VITE_XFTP_SERVER as string | undefined)?.trim() || XFTP_SERVER_PRESETS[0];
}

/** Sélectionne le serveur de fichiers XFTP. */
export function setXftpFileServer(address: string): void {
  try {
    const a = address.trim();
    if (a) localStorage.setItem(XFTP_SERVER_KEY, a);
    else localStorage.removeItem(XFTP_SERVER_KEY);
  } catch {
    // localStorage indisponible
  }
}