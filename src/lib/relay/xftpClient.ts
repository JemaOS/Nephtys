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

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Serveurs de fichiers XFTP proposés (adresse `xftp://<keyHash>@hôte`). */
export const XFTP_SERVER_PRESETS: string[] = [
  'xftp://5vog2Imy1ExJB_7zDZrkV1KDWi96jYFyy9CL6fndBVw@xftp2.simplex.im',
  'xftp://5vog2Imy1ExJB_7zDZrkV1KDWi96jYFyy9CL6fndBVw@xftp.simplex.im',
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

/** Se connecte à un serveur XFTP (handshake HTTP/2 + identité vérifiée). */
export async function connectXftp(address: string): Promise<any> {
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