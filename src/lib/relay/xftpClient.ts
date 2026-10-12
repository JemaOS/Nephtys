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
import { isTorRelayEnabled, getOnionRelayUrl } from './relayClient';
import { getTorClient, onionHttpBase } from './torClient';

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

/**
 * Fabrique un `fetchImpl` qui route les requêtes XFTP **à travers Tor**, via
 * le relais `.onion` (`POST /xftp?host=…&port=…`). Le relais `.onion` ouvre la
 * vraie connexion TLS vers le serveur XFTP : l'IP de l'utilisateur n'est jamais
 * exposée au serveur XFTP, et le relais ne voit que du ciphertext XFTP (E2E).
 *
 * Aucune requête n'est jamais émise en direct vers le serveur XFTP quand Tor est
 * actif : la seule sortie est `torClient.fetch` (circuit Tor).
 */
export function createXftpTorFetchImpl(onionWsUrl: string): typeof fetch {
  const base = onionHttpBase(onionWsUrl);
  if (!base) {
    throw new Error(
      'transfert XFTP refusé : Tor est actif sans adresse `.onion` valide ' +
      '(aucune destination de secours, aucun repli en clair).',
    );
  }
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const target = new URL(raw);
    const host = target.hostname;
    const port = target.port || (target.protocol === 'http:' ? '80' : '443');
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    headers['x-xftp-host'] = host;
    headers['x-xftp-port'] = port;
    if (target.pathname && target.pathname !== '/') {
      headers['x-xftp-path'] = `${target.pathname}${target.search}`;
    }
    const proxyUrl = `${base}/xftp?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`;
    const torClient = await getTorClient();
    return await torClient.fetch(proxyUrl, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ?? undefined,
      signal: init?.signal ?? undefined,
    });
  };
  return impl as unknown as typeof fetch;
}

/** Se connecte à un serveur XFTP (handshake HTTP/2 + identité vérifiée). */
export async function connectXftp(address: string): Promise<any> {
  // 1) `desc.server` (pair-contrôlé) doit pointer un serveur XFTP connu, sans
  //    quoi aucun `fetch` n'est tenté (anti-fuite d'IP).
  assertAllowedXftpServer(address);
  const { keyHash, url } = parseAddress(address);
  // 2) Tor actif ⇒ la connexion XFTP est routée **à travers Tor** via le relais
  //    `.onion` (`/xftp`). Sans `.onion`, on refuse (fail-closed) plutôt que de
  //    révéler l'IP en clair au serveur XFTP.
  if (isTorRelayEnabled()) {
    const onion = getOnionRelayUrl();
    if (!onion) {
      throw new Error(
        'transfert XFTP refusé : Tor est actif mais aucune adresse `.onion` n’est ' +
        'configurée (aucun repli en clair). Configurez le relais `.onion`.',
      );
    }
    return await connectBrowserXftpWebClient({ url, keyHash, fetchImpl: createXftpTorFetchImpl(onion) });
  }
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