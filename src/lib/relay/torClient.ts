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
import { netLog } from './netLog';

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
export function torHttpBase(onionWsUrl?: string): string {
  const raw =
    onionWsUrl ?? (import.meta.env.VITE_SMP_RELAY_ONION_URL as string | undefined) ?? '';
  return onionHttpBase(raw);
}

/**
 * Dérive `http://<…>.onion[/chemin]` d'une adresse `.onion` normalisée
 * (`ws://x.onion`, `https://x.onion/chemin`, …). Renvoie `''` si l'entrée
 * n'est pas une **vraie** adresse `.onion` (v3/v2).
 *
 * Sous Tor, le transport SMP ne cible QUE cette `.onion` : on ne retombe
 * jamais sur le relais clearnet de l'opérateur (pas de fuite d'IP en cas
 * d'échec). `''` ⇒ l'appelant doit refuser (fail-closed).
 */
export function onionHttpBase(onionWsUrl: string): string {
  const value = (onionWsUrl ?? '').trim();
  if (!value) return '';
  const stripped = value.replace(/^[a-z]+:\/\//i, '').split('?')[0].split('#')[0];
  const host = stripped.split('/')[0];
  if (!/^[a-z2-7]{16,56}\.onion(?::\d+)?$/i.test(host)) return '';
  const path = stripped.split('/').slice(1).join('/').replace(/\/+$/, '');
  return `http://${host}${path ? `/${path}` : ''}`;
}

let torClientPromise: Promise<any> | null = null;

/** Bootstrap (mémoïsé) du client Tor WASM. */
export function getTorClient(): Promise<any> {
  if (!torClientPromise) {
    const t0 = Date.now();
    netLog({ layer: 'tor', op: 'bootstrap', status: 'start', endpoint: torGatewayAddress() });
    torClientPromise = (async () => {
      const mod: any = await import('tor-js');
      mod.setWasmUrl?.('/tor_js_bg.wasm');
      const client = new mod.TorClient({
        gateway: torGatewayAddress(),
        logLevel: 'warn',
      });
      await client.ready();
      return client;
    })()
      .then(client => {
        netLog({ layer: 'tor', op: 'bootstrap', status: 'ok', endpoint: torGatewayAddress(), ms: Date.now() - t0 });
        return client;
      })
      .catch((e) => {
        torClientPromise = null;
        netLog({ layer: 'tor', op: 'bootstrap', status: 'fail', endpoint: torGatewayAddress(), detail: (e as Error)?.message, ms: Date.now() - t0 });
        throw e;
      });
  }
  return torClientPromise;
}

/**
 * Fabrique un `WebSocketImpl` (socket fantôme) adossé à `tor-js`, ciblant le
 * **relais `.onion`** configuré. `onionWsUrl` est l'adresse `.onion` résolue
 * (cf. `getOnionRelayUrl`) ; à défaut, `VITE_SMP_RELAY_ONION_URL`.
 *
 * Fail-closed : sans adresse `.onion`, on **refuse** (aucun repli clearnet).
 */
export async function createTorWebSocketImpl(onionWsUrl?: string): Promise<any> {
  const httpBase = torHttpBase(onionWsUrl);
  if (!httpBase) {
    throw new Error(
      'Mode Tor actif sans adresse `.onion` configurée : transport SMP-over-Tor ' +
      'refusé (aucun repli en clair vers le relais opérateur). ' +
      'Configurez une adresse `.onion` du relais.',
    );
  }
  const torClient = await getTorClient();
  return createTorSmpWebSocketImpl({ httpBase, torClient });
}

 
