// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Client Tor WASM (tor-js) pour le mode privé, + adresse de la passerelle KPS.
 *
 * Le client Tor tourne **dans le navigateur** (circuits construits localement) ;
 * la passerelle KPS du VPS ne relaie que des octets opaques (elle voit l'IP,
 * pas la destination). Le WASM est auto-hébergé (`/tor_js_bg.wasm`), donc aucun
 * appel à un CDN tiers.
 */

 

import { createTorSmpWebSocketImpl } from './torSmpTransport';

/**
 * Adresse KPS de la passerelle Tor (`ip:port:certhash`). Surchargeable par
 * `VITE_TOR_GATEWAY`. La valeur par défaut pointe la gateway du VPS Nephtys.
 */
const DEFAULT_GATEWAY = '78.232.3.78:12298:uEiA4pn-2NEoehBFe-WImBbISs4tx_t1TcfrdbjFu5i5w9Q';

export function torGatewayAddress(): string {
  const env = import.meta.env.VITE_TOR_GATEWAY as string | undefined;
  return (env && env.trim()) || DEFAULT_GATEWAY;
}

/** Base HTTP joignable via Tor (endpoints /smp/up et /smp/down). */
export function torHttpBase(): string {
  const relay =
    (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
  try {
    return `https://${new URL(relay).host}`;
  } catch {
    return 'https://78-232-3-78.sslip.io';
  }
}

let torClientPromise: Promise<any> | null = null;

/** Bootstrap (mémoïsé) du client Tor WASM. */
export function getTorClient(): Promise<any> {
  if (!torClientPromise) {
    torClientPromise = (async () => {
      const mod: any = await import('tor-js');
      mod.setWasmUrl?.('/tor_js_bg.wasm');
      const client = new mod.TorClient({
        gateway: torGatewayAddress(),
        logLevel: 'warn',
      });
      await client.ready();
      return client;
    })().catch((e) => {
      torClientPromise = null;
      throw e;
    });
  }
  return torClientPromise;
}

/** Fabrique un `WebSocketImpl` (socket fantôme) adossé à `tor-js`. */
export async function createTorWebSocketImpl(): Promise<any> {
  const torClient = await getTorClient();
  return createTorSmpWebSocketImpl({ httpBase: torHttpBase(), torClient });
}

 
