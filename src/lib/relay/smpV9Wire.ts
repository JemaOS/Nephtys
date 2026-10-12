// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.
//
// Transport SMP v9 « natif » — implémente le protocole SMP v9 tel qu'il a
// été **prouvé** de bout en bout (scripts/smp-v9-flow.mjs) :
//   handshake v9 (keyHash=sha256(CA) + authPubKey) → NEW→IDS → SUB/GET→OK →
//   SEND→MSG → déchiffrement Layer B (nacl.box).
// Il parle à un serveur SMP via le **pont** WebSocket↔TLS natif
// (server/smp-bridge) : le navigateur ne peut pas ouvrir du TLS natif.
//
// Expose la surface `RelayWire` (createQueue/send/read/ack/delete).

import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeTransportBlock } from '../smpweb/browser-smp-core.mjs';
import type { QueueCredentials, StoredEnvelope } from './relayCore';
import type { RelayOp, RelayResponse, RelayWire } from './wire';

const BLOCK = 16384;
const PAD = 0x23;
const V = 9;
const te = new TextEncoder();

const small = (b: Uint8Array): Uint8Array => { const o = new Uint8Array(1 + b.length); o[0] = b.length; o.set(b, 1); return o; };
const concat = (...ps: Uint8Array[]): Uint8Array => { const n = ps.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of ps) { o.set(p, k); k += p.length; } return o; };
const padBlock = (p: Uint8Array): Uint8Array => { const b = new Uint8Array(BLOCK).fill(PAD); b[0] = (p.length >>> 8) & 0xff; b[1] = p.length & 0xff; b.set(p, 2); return b; };
const b64u = (b: Uint8Array): string => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); };
const unb64u = (s: string): Uint8Array => { let b = s.replaceAll('-', '+').replaceAll('_', '/'); while (b.length % 4) b += '='; const bin = atob(b); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
const x25519Spki = (pk: Uint8Array): Uint8Array => concat(new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]), pk);
const ed25519Spki = (pk: Uint8Array): Uint8Array => concat(new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), pk);

export interface SmpV9Options {
  /** URL du pont WebSocket (ex. wss://vps/smp). */
  bridgeUrl: string;
  timeoutMs?: number;
}

/** Connexion SMP v9 : handshake + encodage/décodage des blocs. */
class SmpV9Connection {
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private waiters: (() => void)[] = [];
  sessionId = new Uint8Array(0);
  serverAuthPub = new Uint8Array(0);
  keyHash = new Uint8Array(32);
  /** Version négociée avec le serveur (min(maxServeur, 15)). */
  version = 9;

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  async open(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e: MessageEvent) => {
      this.buf = concat(this.buf, new Uint8Array(e.data as ArrayBuffer));
      for (const w of [...this.waiters]) w();
    };
    await new Promise<void>((res, rej) => { this.ws!.onopen = () => res(); this.ws!.onerror = () => rej(new Error('SMP v9 : pont injoignable')); });
    const hello = this.parseHello(await this.nextBlock());
    this.sessionId = hello.sessionId;
    this.serverAuthPub = hello.authPub;
    this.keyHash = sha256(hello.caCert); // keyHash = sha256(DER du certificat CA)
    // Négociation : on parle jusqu'à 15 (v14+ = relais officiels).
    this.version = Math.min(hello.max, 15);
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
    // v14+ seulement : authPubKey (Large) + proxy. En dessous, pas de auth key.
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
      const t = setTimeout(() => { cl(); rej(new Error('SMP v9 : timeout')); }, timeout);
      const cl = () => { clearTimeout(t); const i = this.waiters.indexOf(read); if (i >= 0) this.waiters.splice(i, 1); };
      this.waiters.push(read); read();
    });
  }

  async handshake(authPubSpki: Uint8Array): Promise<void> {
    // v9 : [v9][keyHash][authPubKey]. v14+ : [v][keyHash]['F'] (proxy=false,
    // sans authPubKey → pas de chiffrement de bloc).
    const payload = this.version >= 14
      ? concat(new Uint8Array([(this.version >> 8) & 0xff, this.version & 0xff]), small(this.keyHash), new Uint8Array([0x46]))
      : concat(new Uint8Array([0, this.version]), small(this.keyHash), small(authPubSpki));
    this.ws!.send(padBlock(payload));
  }

  async command(auth: Uint8Array, corrId: Uint8Array, entityId: Uint8Array, cmd: Uint8Array): Promise<any[]> {
    const body = concat(small(auth), small(corrId), small(entityId), cmd);
    this.ws!.send(padBlock(concat(new Uint8Array([1]), new Uint8Array([(body.length >>> 8) & 0xff, body.length & 0xff]), body)));
    return this.decode(await this.nextBlock());
  }

  /** Envoie sans attendre de réponse (pour SEND sans accusé de réception garanti). */
  send(auth: Uint8Array, corrId: Uint8Array, entityId: Uint8Array, cmd: Uint8Array): void {
    const body = concat(small(auth), small(corrId), small(entityId), cmd);
    this.ws!.send(padBlock(concat(new Uint8Array([1]), new Uint8Array([(body.length >>> 8) & 0xff, body.length & 0xff]), body)));
  }

  async waitResponse(): Promise<any[]> { return this.decode(await this.nextBlock()); }

  decode(block: Uint8Array): any[] {
    // Décodeur éprouvé de la lib, avec la VERSION NÉGOCIÉE (v9..v15) — l'IDS et
    // les commandes diffèrent selon la version.
    const txns = decodeTransportBlock(this.version, block, { kind: 'broker', sessionId: this.sessionId }) as any[];
    return txns.map(t => t.message ?? t);
  }

  close(): void { try { this.ws?.close(); } catch { /* ignore */ } }
}

/**
 * Wire SMP v9 : mappe le protocole SMP sur `RelayWire`.
 * Jetons opaques :
 *   queueId (rcv) : rcvId
 *   sendKey       : sndId du pair (pour SEND)
 *   rcvKey        : authPriv || rcvDhPriv || srvDhPub  (pour GET/ACK + déchiffrement)
 */
export class SmpV9Wire implements RelayWire {
  constructor(private readonly opts: SmpV9Options) {}

  private get timeout(): number { return this.opts.timeoutMs ?? 15_000; }

  async request(op: RelayOp): Promise<RelayResponse> {
    const conn = new SmpV9Connection(this.opts.bridgeUrl, this.timeout);
    try {
      await conn.open();

      if (op.op === 'createQueue') {
        const auth = nacl.box.keyPair();
        await conn.handshake(x25519Spki(auth.publicKey));
        await new Promise(r => setTimeout(r, 250));
        return await this.createQueue(conn, auth);
      }

      if (op.op === 'send') {
        // SEND : pas d'auth, handshake avec une clé jetable.
        const throwaway = nacl.box.keyPair();
        await conn.handshake(x25519Spki(throwaway.publicKey));
        await new Promise(r => setTimeout(r, 250));
        return await this.doSend(conn, op);
      }

      // read/ack/delete : handshake jetable ; la signature Ed25519 est dans le jeton.
      const throwaway = nacl.box.keyPair();
      await conn.handshake(x25519Spki(throwaway.publicKey));
      await new Promise(r => setTimeout(r, 250));

      switch (op.op) {
        case 'read': return await this.doRead(conn, op);
        case 'ack': return await this.doAck(conn, op);
        case 'delete': return await this.doDelete(conn, op);
        default: return { ok: false, error: `SMP v9 : op ${(op as { op: string }).op} non gérée` };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      conn.close();
    }
  }

private async createQueue(conn: SmpV9Connection, auth: nacl.BoxKeyPair): Promise<RelayResponse> {
    const ed = nacl.sign.keyPair();
    const x = nacl.box.keyPair();
    // File « contact » : accepte les SEND **non signés** (aucun SKEY requis).
    //   v15 : QueueReqData = '1C0' (contact) ; v14 : 'F' ; v9 : 'F'.
    const reqData = conn.version >= 15 ? te.encode('1C0') : te.encode('F');
    const cmd = concat(te.encode('NEW '), small(ed25519Spki(ed.publicKey)), small(x25519Spki(x.publicKey)), te.encode('0S'), reqData);
    const corrId = nacl.randomBytes(24);
    const txns = await conn.command(nacl.sign.detached(concat(small(conn.sessionId), small(corrId), small(new Uint8Array(0)), cmd), ed.secretKey), corrId, new Uint8Array(0), cmd);
    const ids = txns.find(t => t.type === 'IDS');
    if (!ids) return { ok: false, error: `SMP v9 : IDS absent (reçu: ${txns.map(t => t.type).join(',') || 'vide'})` };
    const creds: QueueCredentials = {
      queueId: b64u(ids.rcvId),
      sendKey: b64u(ids.sndId),
      rcvKey: b64u(concat(ed.secretKey, x.secretKey, ids.rcvPublicDhKey.subarray(-32))),
      relay: this.opts.bridgeUrl,
    };
    void auth;
    return { ok: true, result: creds };
  }

  private async doSend(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'send' }>): Promise<RelayResponse> {
    const sndId = unb64u(op.queueKey);
    const cmd = concat(te.encode('SEND '), te.encode('F '), unb64u(op.ciphertext));
    const corrId = nacl.randomBytes(24);
    // File contact : SEND NON signé (auth vide).
    conn.send(new Uint8Array(0), corrId, sndId, cmd);
    const txns = await conn.waitResponse();
    return txns.some(t => t.type === 'OK') || txns.some(t => t.type === 'MSG')
      ? { ok: true, result: { id: b64u(corrId) } }
      : { ok: false, error: txns[0]?.text ?? 'SMP v9 : SEND refusé' };
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

