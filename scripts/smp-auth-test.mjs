// Test auth SMP via CbAuthenticator (crypto_box DH) — SKEY puis SEND.
import { randomBytes, createHash } from 'node:crypto';
import { xsalsa20poly1305 } from '@noble/ciphers/salsa.js';
import { sha512 } from '@noble/hashes/sha2.js';
import * as core from '../src/lib/simplexweb/browser-smp-core.mjs';

const URL = process.env.BRIDGE || 'ws://127.0.0.1:8098';
const V = 15;
const small = b => Buffer.concat([Buffer.from([b.length]), Buffer.from(b)]);
const pad = p => { const b = Buffer.alloc(16384, 0x23); b.writeUInt16BE(p.length, 0); Buffer.from(p).copy(b, 2); return b; };
const txt = (b, n = 120) => { let s = ''; for (const x of b.subarray(0, n)) s += (x >= 32 && x < 127) ? String.fromCharCode(x) : '.'; return s; };

// crypto_box sans padding : tag(16) préfixé + ciphertext
function cbNoPad(shared, nonce, msg) {
  const sealed = xsalsa20poly1305(shared, nonce).encrypt(msg); // ct || tag(16)
  const ct = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  return Buffer.concat([Buffer.from(tag), Buffer.from(ct)]);
}
function parseHello(block) {
  const L = block.readUInt16BE(0), p = block.subarray(2, 2 + L);
  const sl = p[4], sid = p.subarray(5, 5 + sl), chain = p.subarray(5 + sl);
  const count = chain[0]; let off = 1; const certs = [];
  for (let i = 0; i < count; i++) { const len = chain.readUInt16BE(off); off += 2; certs.push(chain.subarray(off, off + len)); off += len; }
  return { sid, certs };
}
const rawDh = der => { // retire le préfixe SPKI X25519 (12 octets) -> 32 octets
  const b = Buffer.from(der); return b.subarray(b.length - 32);
};

const ws = new WebSocket(URL); ws.binaryType = 'arraybuffer';
let buf = Buffer.alloc(0); const waiters = [];
ws.onmessage = e => { buf = Buffer.concat([buf, Buffer.from(e.data)]); [...waiters].forEach(w => w()); };
const nextBlock = (t = 9000) => new Promise((res, rej) => {
  const rd = () => { if (buf.length >= 16384) { const b = buf.subarray(0, 16384); buf = buf.subarray(16384); cl(); res(b); } };
  const to = setTimeout(() => { cl(); rej(new Error('timeout')); }, t);
  function cl() { clearTimeout(to); const i = waiters.indexOf(rd); if (i >= 0) waiters.splice(i, 1); }
  waiters.push(rd); rd();
});
// construit une transmission avec CbAuthenticator
function authedTx(sessionId, cmd, duration, entityId, boxKey) {
  const corrId = randomBytes(24);
  const tForAuth = Buffer.concat([small(sessionId), small(corrId), small(entityId), cmd]);
  const auth = cbNoPad(boxKey, new Uint8Array(corrId), sha512(tForAuth));
  const wire = Buffer.concat([small(corrId), small(entityId), cmd]);
  const tx = Buffer.concat([small(auth), wire]);
  const body = Buffer.concat([Buffer.from([1]), Buffer.from([tx.length >> 8, tx.length & 0xff]), tx]);
  return pad(body);
}

try {
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  const hello = parseHello(await nextBlock());
  const ca = hello.certs.at(-1);
  ws.send(pad(core.encodeClientHandshake({ version: V, keyHash: createHash('sha256').update(ca).digest(), proxyServer: false })));
  await new Promise(r => setTimeout(r, 300));

  // NEW (ed25519 sig OK pour NEW)
  const ed = core.generateEd25519KeyPair(); const x = core.generateX25519KeyPair();
  const newCmd = Buffer.concat([Buffer.from('NEW '), small(core.encodePublicKeyDer('Ed25519', ed.publicKey)), small(core.encodePublicKeyDer('X25519', x.publicKey)), '0', 'S', '1M0'].map(String => Buffer.from(String)));
  const corrId = randomBytes(24);
  const signedNew = Buffer.concat([small(hello.sid), small(corrId), small(new Uint8Array(0)), newCmd]);
  const sig = core.ed25519Sign(ed.secretKey, signedNew);
  const newTx = Buffer.concat([small(sig), small(corrId), small(new Uint8Array(0)), newCmd]);
  ws.send(pad(Buffer.concat([Buffer.from([1]), Buffer.from([newTx.length >> 8, newTx.length & 0xff]), newTx])));
  const idsBlock = await nextBlock();
  const ids = core.decodeTransportBlock(V, idsBlock, { kind: 'broker', sessionId: hello.sid }).map(t => t.message).find(m => m.type === 'IDS');
  console.log('IDS', ids ? `rcv=${ids.rcvId.length} snd=${ids.sndId.length} dh=${ids.rcvPublicDhKey.length}` : 'aucun');
  if (!ids) process.exit(0);

  // clé DH partagée = x25519(x.priv, srvDhPub)
  const srvDhRaw = rawDh(ids.rcvPublicDhKey);
  const shared = core.x25519SharedSecret(x.secretKey, srvDhRaw);
  console.log('shared secret', shared.length, 'octets');

  // SKEY avec CbAuthenticator (entity = rcvId)
  const senderEd = core.generateEd25519KeyPair();
  const skeyCmd = Buffer.concat([Buffer.from('SKEY '), small(core.encodePublicKeyDer('Ed25519', senderEd.publicKey))]);
  ws.send(authedTx(hello.sid, skeyCmd, 0, ids.rcvId, shared));
  let rk = await nextBlock().catch(() => null);
  if (rk) console.log('SKEY ->', core.decodeTransportBlock(V, rk, { kind: 'broker', sessionId: hello.sid }).map(t => t.message.type + ' ' + txt(t.commandBytes || new Uint8Array(), 40)).join(' | '));
  else console.log('SKEY -> aucune réponse');

  // SEND avec CbAuthenticator (entity = sndId)
  const sendCmd = core.encodeCommand(V, { type: 'SEND', flags: { notification: false }, body: new TextEncoder().encode('nephtys') });
  ws.send(authedTx(hello.sid, Buffer.from(sendCmd), 0, ids.sndId, shared));
  let sb = await nextBlock().catch(() => null);
  if (sb) console.log('SEND ->', core.decodeTransportBlock(V, sb, { kind: 'broker', sessionId: hello.sid }).map(t => t.message.type + ' ' + txt(t.commandBytes || new Uint8Array(), 40)).join(' | '));
  else console.log('SEND -> aucune réponse');
} catch (e) { console.log('ERREUR', e.message); }
finally { try { ws.close(); } catch { } process.exit(0); }