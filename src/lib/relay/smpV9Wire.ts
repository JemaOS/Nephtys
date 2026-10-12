// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.
//
// Transport SMP v9 « natif » — implémente le protocole SimpleX v9 tel qu'il a
// été **prouvé** de bout en bout (scripts/smp-v9-flow.mjs) :
//   handshake v9 (keyHash=sha256(CA) + authPubKey) → NEW→IDS → SUB/GET→OK →
//   SEND→MSG → déchiffrement Layer B (nacl.box).
// Il parle à un serveur SimpleX via le **pont** WebSocket↔TLS natif
// (server/simplex-bridge) : le navigateur ne peut pas ouvrir du TLS natif.
//
// Expose la surface `RelayWire` (createQueue/send/read/ack/delete).

import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
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
  /** URL du pont WebSocket (ex. wss://vps/simplex). */
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
  }

  private parseHello(block: Uint8Array) {
    const L = (block[0] << 8) | block[1];
    const p = block.subarray(2, 2 + L);
    const sl = p[4];
    const sessionId = p.subarray(5, 5 + sl);
    let off = 5 + sl;
    const count = p[off]; off += 1;
    const certs: Uint8Array[] = [];
    for (let i = 0; i < count; i++) { const len = (p[off] << 8) | p[off + 1]; off += 2; certs.push(p.subarray(off, off + len)); off += len; }
    const authLen = (p[off] << 8) | p[off + 1]; off += 2;
    const authDer = p.subarray(off, off + authLen);
    return { sessionId, authPub: authDer.subarray(authDer.length - 32), caCert: certs.at(-1)! };
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
    this.ws!.send(padBlock(concat(new Uint8Array([0, V]), small(this.keyHash), small(authPubSpki))));
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
    const L = (block[0] << 8) | block[1];
    const p = block.subarray(2, 2 + L);
    const count = p[0];
    let off = 1;
    const out: any[] = [];
    for (let i = 0; i < count; i++) {
      const len = (p[off] << 8) | p[off + 1]; off += 2;
      const tx = p.subarray(off, off + len); off += len;
      let o = 0;
      o += 1 + tx[o]; o += 1 + tx[o]; o += 1 + tx[o];
      out.push(this.parseCommand(tx.subarray(o)));
    }
    return out;
  }

  private parseCommand(bytes: Uint8Array): any {
    const type = new TextDecoder().decode(bytes.subarray(0, 3));
    if (type === 'IDS') {
      let o = 4;
      const sl = bytes[o]; o += 1; const rcvId = bytes.subarray(o, o + sl); o += sl;
      const dl = bytes[o]; o += 1; const sndId = bytes.subarray(o, o + dl); o += dl;
      const dhl = bytes[o]; o += 1; const rcvPublicDhKey = bytes.subarray(o, o + dhl);
      return { type: 'IDS', rcvId, sndId, rcvPublicDhKey };
    }
    if (type === 'MSG') {
      let o = 4;
      const ml = bytes[o]; o += 1; const msgId = bytes.subarray(o, o + ml);
      return { type: 'MSG', msgId, body: bytes.subarray(o) };
    }
    if (type === 'ERR') return { type: 'ERR', text: new TextDecoder().decode(bytes.slice(0, 40)) };
    if (type === 'OK' || type === 'SUB') return { type: 'OK' };
    return { type };
  }

  close(): void { try { this.ws?.close(); } catch { /* ignore */ } }
}

/**
 * Wire SMP v9 : mappe le protocole SimpleX sur `RelayWire`.
 * Jetons opaques :
 *   queueId (rcv) : rcvId
 *   sendKey       : sndId du pair (pour SEND)
 *   rcvKey        : authPriv || rcvDhPriv || srvDhPub  (pour GET/ACK + déchiffrement)
 */
export class SmpV9Wire implements RelayWire {
  constructor(private readonly opts: SmpV9Options) {}

  private get timeout(): number { return this.opts.timeoutMs ?? 15_000; }

  /** CbAuthenticator v9 : nacl.box(sha512(t), corrId, srvAuthPub, notrePrivAuth). */
  private cbAuth(authPriv: Uint8Array, srvDhPub: Uint8Array, corrId: Uint8Array, entityId: Uint8Array, cmd: Uint8Array, sessionId: Uint8Array): Uint8Array {
    const h = nacl.hash(concat(small(sessionId), small(corrId), small(entityId), cmd));
    const boxed = nacl.box(h, corrId, srvDhPub, authPriv);
    return concat(boxed.subarray(boxed.length - 16), boxed.subarray(0, boxed.length - 16));
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    const conn = new SmpV9Connection(this.opts.bridgeUrl, this.timeout);
    try {
      await conn.open();
      const auth = nacl.box.keyPair();
      await conn.handshake(x25519Spki(auth.publicKey));
      await new Promise(r => setTimeout(r, 250));
      switch (op.op) {
        case 'createQueue': return await this.createQueue(conn, auth);
        case 'send': return await this.doSend(conn, op);
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
    const cmd = concat(te.encode('NEW '), small(ed25519Spki(ed.publicKey)), small(x25519Spki(x.publicKey)), te.encode('0ST'));
    const corrId = nacl.randomBytes(24);
    const txns = await conn.command(nacl.sign.detached(concat(small(conn.sessionId), small(corrId), small(new Uint8Array(0)), cmd), ed.secretKey), corrId, new Uint8Array(0), cmd);
    const ids = txns.find(t => t.type === 'IDS');
    if (!ids) return { ok: false, error: `SMP v9 : IDS absent (reçu: ${txns.map(t => t.type + (t.text ? ':' + t.text : '')).join(',') || 'vide'})` };
    const creds: QueueCredentials = {
      queueId: b64u(ids.rcvId),
      sendKey: b64u(ids.sndId),
      rcvKey: b64u(concat(auth.secretKey, x.secretKey, ids.rcvPublicDhKey)),
      relay: this.opts.bridgeUrl,
    };
    return { ok: true, result: creds };
  }

  private async doSend(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'send' }>): Promise<RelayResponse> {
    const sndId = unb64u(op.queueKey);
    const cmd = concat(te.encode('SEND '), te.encode('F '), unb64u(op.ciphertext));
    const corrId = nacl.randomBytes(24);
    conn.send(new Uint8Array(0), corrId, sndId, cmd); // queue non sécurisée : pas d'auth
    const txns = await conn.waitResponse();
    return txns.some(t => t.type === 'OK') || txns.some(t => t.type === 'MSG')
      ? { ok: true, result: { id: b64u(corrId) } }
      : { ok: false, error: txns[0]?.text ?? 'SMP v9 : SEND refusé' };
  }

  private async doRead(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'read' }>): Promise<RelayResponse> {
    const rcvId = unb64u(op.queueId);
    const packed = unb64u(op.queueKey);
    const authPriv = packed.subarray(0, 32);
    const rcvDhPriv = packed.subarray(32, 64);
    const srvDhPub = packed.subarray(64, 96);
    const cmd = te.encode('GET');
    const corrId = nacl.randomBytes(24);
    const txns = await conn.command(this.cbAuth(authPriv, conn.serverAuthPub, corrId, rcvId, cmd, conn.sessionId), corrId, rcvId, cmd);
    const out: StoredEnvelope[] = [];
    for (const t of txns) {
      if (t.type !== 'MSG') continue;
      const plain = nacl.box.open(t.body, t.msgId, srvDhPub, rcvDhPriv);
      if (!plain) continue;
      // RcvMsgBody : SystemTime(12) + MsgFlags(1) + ' ' + body
      const body = plain.subarray(14);
      out.push({ id: b64u(t.msgId), ciphertext: b64u(body), ts: Date.now(), expiresAt: 0 });
    }
    return { ok: true, result: out };
  }

  private async doAck(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'ack' }>): Promise<RelayResponse> {
    const rcvId = unb64u(op.queueId);
    const packed = unb64u(op.queueKey);
    const authPriv = packed.subarray(0, 32);
    for (const id of op.ids) {
      const msgId = unb64u(id);
      const cmd = concat(te.encode('ACK '), small(msgId));
      const corrId = nacl.randomBytes(24);
      await conn.command(this.cbAuth(authPriv, conn.serverAuthPub, corrId, rcvId, cmd, conn.sessionId), corrId, rcvId, cmd);
    }
    return { ok: true, result: true };
  }

  private async doDelete(conn: SmpV9Connection, op: Extract<RelayOp, { op: 'delete' }>): Promise<RelayResponse> {
    const rcvId = unb64u(op.queueId);
    const packed = unb64u(op.queueKey);
    const authPriv = packed.subarray(0, 32);
    const cmd = te.encode('DEL');
    const corrId = nacl.randomBytes(24);
    await conn.command(this.cbAuth(authPriv, conn.serverAuthPub, corrId, rcvId, cmd, conn.sessionId), corrId, rcvId, cmd);
    return { ok: true, result: true };
  }
}

