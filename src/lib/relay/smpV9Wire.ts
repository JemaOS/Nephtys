// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.
//
// Transport SMP (v9..v15) « natif » — implémente le protocole SMP tel qu'il a
// été prouvé de bout en bout : handshake (keyHash=sha256(CA)) → NEW→IDS →
// SUB/GET→OK → SEND→MSG → déchiffrement Layer B (nacl.box).
// Il parle à un serveur SMP via le **pont** WebSocket↔TLS natif
// (server/smp-bridge) : le navigateur ne peut pas ouvrir du TLS natif.
//
// PERF : une **connexion persistante par relais** (handshake une seule fois)
// est réutilisée pour toutes les opérations, qui sont **sérialisées** (le
// protocole SMP n'est pas concurrency-safe sur une même connexion).

import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeTransportBlock } from '../smpweb/browser-smp-core.mjs';
import type { QueueCredentials, StoredEnvelope } from './relayCore';
import type { RelayOp, RelayResponse, RelayWire } from './wire';

const BLOCK = 16384;
const PAD = 0x23;
const te = new TextEncoder();

const small = (b: Uint8Array): Uint8Array => { const o = new Uint8Array(1 + b.length); o[0] = b.length; o.set(b, 1); return o; };
const concat = (...ps: Uint8Array[]): Uint8Array => { const n = ps.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of ps) { o.set(p, k); k += p.length; } return o; };
const padBlock = (p: Uint8Array): Uint8Array => { const b = new Uint8Array(BLOCK).fill(PAD); b[0] = (p.length >>> 8) & 0xff; b[1] = p.length & 0xff; b.set(p, 2); return b; };
const b64u = (b: Uint8Array): string => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); };
const unb64u = (s: string): Uint8Array => { let b = s.replaceAll('-', '+').replaceAll('_', '/'); while (b.length % 4) b += '='; const bin = atob(b); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
const x25519Spki = (pk: Uint8Array): Uint8Array => concat(new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]), pk);
const ed25519Spki = (pk: Uint8Array): Uint8Array => concat(new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), pk);

/** Relais SMP publics par défaut (sélectionnables dans Serveurs et réseaux). */
export const SMP_RELAY_PRESETS: string[] = [
  'smp10.simplex.im',
  'smp11.simplex.im',
  'smp12.simplex.im',
  'smp14.simplex.im',
  'smp15.simplex.im',
  'smp16.simplex.im',
  'smp17.simplex.im',
  'smp18.simplex.im',
  'smp19.simplex.im',
  'smp4.simplex.im',
  'smp5.simplex.im',
  'smp6.simplex.im',
  'smp8.simplex.im',
  'smp9.simplex.im',
];

export interface SmpV9Options {
  /** URL du pont WebSocket (ex. wss://vps/smp). */
  bridgeUrl: string;
  /** Hôte du serveur SMP cible (ex. smp10.simplex.im) ; transmis au pont. */
  host?: string;
  timeoutMs?: number;
}

/** Connexion SMP : handshake d'un côté, encodage/décodage des blocs de l'autre. */
class SmpV9Connection {
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private waiters: (() => void)[] = [];
  sessionId = new Uint8Array(0);
  serverAuthPub = new Uint8Array(0);
  keyHash = new Uint8Array(32);
  version = 9;
  private opened = false;

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  get isOpen(): boolean { return this.opened && !!this.ws && this.ws.readyState === 1; }

  async open(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e: MessageEvent) => {
      this.buf = concat(this.buf, new Uint8Array(e.data as ArrayBuffer));
      for (const w of [...this.waiters]) w();
    };
    this.ws.onclose = () => { this.opened = false; };
    // Délai d'attente SUR L'OUVERTURE : un pont qui ne répond pas (handshake WS
    // bloqué, ex. mauvais chemin proxifié) laissait sinon la création pendre
    // jusqu'au timeout TCP du navigateur (~1 min) avant tout repli. On borne par
    // `timeoutMs` pour échouer vite et laisser le repli s'enclencher.
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => { try { this.ws?.close(); } catch { /* ignore */ } rej(new Error('SMP : pont injoignable (délai de connexion)')); }, this.timeoutMs);
      const ok = () => { clearTimeout(t); res(); };
      const ko = () => { clearTimeout(t); rej(new Error('SMP : pont injoignable')); };
      this.ws!.onopen = ok;
      this.ws!.onerror = ko;
    });
    const hello = this.parseHello(await this.nextBlock());
    this.sessionId = hello.sessionId;
    this.serverAuthPub = hello.authPub;
    this.keyHash = sha256(hello.caCert);
    this.version = Math.min(hello.max, 15);
    this.opened = true;
  }

  private parseHello(block: Uint8Array) {
    const L = (block[0] << 8) | block[1];
    const p = block.subarray(2, 2 + L);
    const max = (p[2] << 8) | p[3];
    const sl = p[4];
    const sessionId = p.subarray(5, 5 + sl);
    let off = 5 + sl;
    const count = p[off]; off += 1;
    const certs: Uint8Array[] = [];
    for (let i = 0; i < count; i++) { const len = (p[off] << 8) | p[off + 1]; off += 2; certs.push(p.subarray(off, off + len)); off += len; }
    let authPub = new Uint8Array(0);
    if (max >= 14) {
      const authLen = (p[off] << 8) | p[off + 1]; off += 2;
      authPub = p.subarray(off, off + authLen).subarray(-32);
    }
    return { max, sessionId, authPub, caCert: certs.at(-1)! };
  }

  private nextBlock(timeout = this.timeoutMs): Promise<Uint8Array> {
    return new Promise((res, rej) => {
      const read = () => { if (this.buf.length >= BLOCK) { const b = this.buf.subarray(0, BLOCK); this.buf = this.buf.subarray(BLOCK); cl(); res(b); } };
      const t = setTimeout(() => { cl(); rej(new Error('SMP : timeout')); }, timeout);
      const cl = () => { clearTimeout(t); const i = this.waiters.indexOf(read); if (i >= 0) this.waiters.splice(i, 1); };
      this.waiters.push(read); read();
    });
  }

  /** Handshake v14+ : [v][keyHash]['F'] (sans clé client → pas de chiffrement de bloc). */
  async handshake(): Promise<void> {
    const payload = this.version >= 14
      ? concat(new Uint8Array([(this.version >> 8) & 0xff, this.version & 0xff]), small(this.keyHash), new Uint8Array([0x46]))
      : concat(new Uint8Array([0, this.version]), small(this.keyHash), small(x25519Spki(nacl.box.keyPair().publicKey)));
    this.ws!.send(padBlock(payload));
    await new Promise(r => setTimeout(r, 200));
  }

  async command(auth: Uint8Array, corrId: Uint8Array, entityId: Uint8Array, cmd: Uint8Array): Promise<any[]> {
    const body = concat(small(auth), small(corrId), small(entityId), cmd);
    this.ws!.send(padBlock(concat(new Uint8Array([1]), new Uint8Array([(body.length >>> 8) & 0xff, body.length & 0xff]), body)));
    return this.decode(await this.nextBlock());
  }

  send(auth: Uint8Array, corrId: Uint8Array, entityId: Uint8Array, cmd: Uint8Array): void {
    const body = concat(small(auth), small(corrId), small(entityId), cmd);
    this.ws!.send(padBlock(concat(new Uint8Array([1]), new Uint8Array([(body.length >>> 8) & 0xff, body.length & 0xff]), body)));
  }

  async waitResponse(): Promise<any[]> { return this.decode(await this.nextBlock()); }

  decode(block: Uint8Array): any[] {
    const txns = decodeTransportBlock(this.version, block, { kind: 'broker', sessionId: this.sessionId }) as any[];
    return txns.map(t => t.message ?? t);
  }

  close(): void { try { this.ws?.close(); } catch { /* ignore */ } this.opened = false; }
}

/**
 * Gestionnaire de connexion persistante par relais : handshake une seule fois,
 * requêtes **sérialisées** (chaîne de promesses). Se reconnecte si la connexion
 * est tombée.
 */
class PersistentSmp {
  private conn: SmpV9Connection | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly url: string, private readonly timeout: number) {}

  run<T>(fn: (c: SmpV9Connection) => Promise<T>): Promise<T> {
    const exec = async (): Promise<T> => {
      const c = await this.ensure();
      try {
        return await fn(c);
      } catch (e) {
        this.reset();
        throw e;
      }
    };
    const p = this.chain.then(exec);
    this.chain = p.catch(() => { /* la suivante repart proprement */ });
    return p;
  }

  private async ensure(): Promise<SmpV9Connection> {
    if (this.conn?.isOpen) return this.conn;
    const c = new SmpV9Connection(this.url, this.timeout);
    await c.open();
    await c.handshake();
    this.conn = c;
    return c;
  }

  private reset(): void { try { this.conn?.close(); } catch { /* ignore */ } this.conn = null; }
}

export class SmpV9Wire implements RelayWire {
  /**
   * Connexion persistante PAR INSTANCE (un wire = un pair) : jamais partagée
   * entre deux clients distincts, mais réutilisée pour toutes les opérations
   * d'un même client (handshake une seule fois).
   */
  private persistent: PersistentSmp | null = null;

  constructor(private readonly opts: SmpV9Options) {}

  private get timeout(): number { return this.opts.timeoutMs ?? 15_000; }

  /** URL effective du pont, avec l'hôte SMP cible en paramètre. */
  private get url(): string {
    const base = this.opts.bridgeUrl;
    if (!this.opts.host) return base;
    try {
      const u = new URL(base);
      u.searchParams.set('host', this.opts.host);
      return u.toString();
    } catch {
      return base;
    }
  }

  private get persistentConn(): PersistentSmp {
    if (!this.persistent) this.persistent = new PersistentSmp(this.url, this.timeout);
    return this.persistent;
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    try {
      return await this.persistentConn.run(conn => this.dispatch(conn, op));
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async dispatch(conn: SmpV9Connection, op: RelayOp): Promise<RelayResponse> {
    switch (op.op) {
      case 'createQueue': return await this.createQueue(conn);
      case 'send': return await this.doSend(conn, op);
      case 'read': return await this.doRead(conn, op);
      case 'ack': return await this.doAck(conn, op);
      case 'delete': return await this.doDelete(conn, op);
      default: return { ok: false, error: `SMP : op ${(op as { op: string }).op} non gérée` };
    }
  }

  private async createQueue(conn: SmpV9Connection): Promise<RelayResponse> {
    const ed = nacl.sign.keyPair();
    const x = nacl.box.keyPair();
    // File « contact » : accepte les SEND non signés (aucun SKEY requis).
    const reqData = conn.version >= 15 ? te.encode('1C0') : te.encode('F');
    const cmd = concat(te.encode('NEW '), small(ed25519Spki(ed.publicKey)), small(x25519Spki(x.publicKey)), te.encode('0S'), reqData);
    const corrId = nacl.randomBytes(24);
    const txns = await conn.command(nacl.sign.detached(concat(small(conn.sessionId), small(corrId), small(new Uint8Array(0)), cmd), ed.secretKey), corrId, new Uint8Array(0), cmd);
    const ids = txns.find(t => t.type === 'IDS');
    if (!ids) return { ok: false, error: `SMP : IDS absent (reçu: ${txns.map(t => t.type).join(',') || 'vide'})` };
    const creds: QueueCredentials = {
      queueId: b64u(ids.rcvId),
      sendKey: b64u(ids.sndId),
      rcvKey: b64u(concat(ed.secretKey, x.secretKey, ids.rcvPublicDhKey.subarray(-32))),
      relay: this.url,
    };
    return { ok: true, result: creds };
  }

  private async doSend(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'send' }>): Promise<RelayResponse> {
    const sndId = unb64u(op.queueKey);
    const cmd = concat(te.encode('SEND '), te.encode('F '), unb64u(op.ciphertext));
    const corrId = nacl.randomBytes(24);
    conn.send(new Uint8Array(0), corrId, sndId, cmd);
    const txns = await conn.waitResponse();
    return txns.some(t => t.type === 'OK') || txns.some(t => t.type === 'MSG')
      ? { ok: true, result: { id: b64u(corrId) } }
      : { ok: false, error: txns[0]?.text ?? 'SMP : SEND refusé' };
  }

  private async doRead(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'read' }>): Promise<RelayResponse> {
    const rcvId = unb64u(op.queueId);
    const packed = unb64u(op.queueKey);
    const edSecret = packed.subarray(0, 64);
    const rcvDhPriv = packed.subarray(64, 96);
    const srvDhPub = packed.subarray(96, 128);
    const cmd = te.encode('GET');
    const corrId = nacl.randomBytes(24);
    const sig = nacl.sign.detached(concat(small(conn.sessionId), small(corrId), small(rcvId), cmd), edSecret);
    const txns = await conn.command(sig, corrId, rcvId, cmd);
    const out: StoredEnvelope[] = [];
    for (const t of txns) {
      if (t.type !== 'MSG') continue;
      const plain = nacl.box.open(t.body, t.msgId, srvDhPub, rcvDhPriv);
      if (!plain) continue;
      // Plaintext = word16(RcvMsgBody len) ‖ header(10) ‖ body ‖ '#' padding.
      const rl = (plain[0] << 8) | plain[1];
      const body = plain.subarray(12, 2 + rl);
      out.push({ id: b64u(t.msgId), ciphertext: b64u(body), ts: Date.now(), expiresAt: 0 });
    }
    return { ok: true, result: out };
  }

  private async doAck(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'ack' }>): Promise<RelayResponse> {
    const rcvId = unb64u(op.queueId);
    const edSecret = unb64u(op.queueKey).subarray(0, 64);
    for (const id of op.ids) {
      const msgId = unb64u(id);
      const cmd = concat(te.encode('ACK '), small(msgId));
      const corrId = nacl.randomBytes(24);
      const sig = nacl.sign.detached(concat(small(conn.sessionId), small(corrId), small(rcvId), cmd), edSecret);
      await conn.command(sig, corrId, rcvId, cmd);
    }
    return { ok: true, result: true };
  }

  private async doDelete(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'delete' }>): Promise<RelayResponse> {
    const rcvId = unb64u(op.queueId);
    const edSecret = unb64u(op.queueKey).subarray(0, 64);
    const cmd = te.encode('DEL');
    const corrId = nacl.randomBytes(24);
    const sig = nacl.sign.detached(concat(small(conn.sessionId), small(corrId), small(rcvId), cmd), edSecret);
    await conn.command(sig, corrId, rcvId, cmd);
    return { ok: true, result: true };
  }
}