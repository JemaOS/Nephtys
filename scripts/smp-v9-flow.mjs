// Flux SMP v9 COMPLET (auth CbAuthenticator nacl.box) — d'après GoChat Season 8.
// handshake: [w16 v9][0x20][32 keyHash][1=44 authPub SPKI]
// auth CbAuthenticator = nacl.box(sha512(sessionId||corrId||entityId||cmd), corrId, serverAuthPub, ourAuthPriv) -> tag||ct (80o)
// NEW v9:  "NEW " [44 Ed25519 SPKI] [44 X25519 SPKI] '0' 'S' 'T'
// SKEY:    "SKEY " [44 Ed25519 SPKI]        SEND: "SEND " 'F' ' ' body       SUB/GET/ACK (entity=rcvId)
import { randomBytes, createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import * as core from '../src/lib/smpweb/browser-smp-core.mjs';

const URL = process.env.BRIDGE || 'ws://127.0.0.1:8098';
const V = 9;
const small = b => Buffer.concat([Buffer.from([b.length]), Buffer.from(b)]);
const pad = p => { const b = Buffer.alloc(16384, 0x23); b.writeUInt16BE(p.length, 0); Buffer.from(p).copy(b, 2); return b; };
const txt = (b, n = 90) => { let s = ''; for (const x of Buffer.from(b).subarray(0, n)) s += (x >= 32 && x < 127) ? String.fromCharCode(x) : '.'; return s; };
const raw32 = spki => { const b = Buffer.from(spki); return b.subarray(b.length - 32); };

function parseHello(block) {
  const L = block.readUInt16BE(0), p = block.subarray(2, 2 + L);
  const min = p.readUInt16BE(0), max = p.readUInt16BE(2), sl = p[4];
  const sessionId = p.subarray(5, 5 + sl);
  let off = 5 + sl; const count = p[off]; off += 1; const certs = [];
  for (let i = 0; i < count; i++) { const len = p.readUInt16BE(off); off += 2; certs.push(p.subarray(off, off + len)); off += len; }
  // authPubKey après la chaîne : Large (word16 len) + DER SPKI X25519
  const authLen = p.readUInt16BE(off);
  const serverAuthPub = p.subarray(off + 2, off + 2 + authLen);
  return { min, max, sessionId, certs, serverAuthPub };
}
const ws = new WebSocket(URL); ws.binaryType = 'arraybuffer';
let buf = Buffer.alloc(0); const waiters = [];
ws.onmessage = e => { buf = Buffer.concat([buf, Buffer.from(e.data)]); [...waiters].forEach(w => w()); };
const nextBlock = (t = 9000) => new Promise((res, rej) => {
  const rd = () => { if (buf.length >= 16384) { const b = buf.subarray(0, 16384); buf = buf.subarray(16384); cl(); res(b); } };
  const to = setTimeout(() => { cl(); rej(new Error('timeout')); }, t);
  function cl() { clearTimeout(to); const i = waiters.indexOf(rd); if (i >= 0) waiters.splice(i, 1); }
  waiters.push(rd); rd();
});

// CbAuthenticator (85o dans notre cas : 16 tag + 64 ct) avec authenticator type
function cbAuth(ourAuthPriv, serverAuthPubRaw, sessionId, corrId, entityId, cmd) {
  const tForAuth = Buffer.concat([small(sessionId), small(corrId), small(entityId), Buffer.from(cmd)]);
  const h = Buffer.from(nacl.hash(tForAuth)); // sha512 -> 64
  const boxed = nacl.box(h, corrId, serverAuthPubRaw, ourAuthPriv); // ct(64)||tag(16)
  const tag = boxed.subarray(boxed.length - 16), ct = boxed.subarray(0, boxed.length - 16);
  return Buffer.concat([tag, ct]); // tag||ct
}
function tx(auth, corrId, entityId, cmd) {
  const body0 = Buffer.concat([small(auth), small(corrId), small(entityId), Buffer.from(cmd)]);
  return Buffer.concat([Buffer.from([1]), Buffer.from([body0.length >> 8, body0.length & 0xff]), body0]);
}
// signature Ed25519 (v6-style) sur tForAuth
function sigTx(privKey, sessionId, corrId, entityId, cmd) {
  const tForAuth = Buffer.concat([small(sessionId), small(corrId), small(entityId), Buffer.from(cmd)]);
  const s = core.ed25519Sign(privKey, tForAuth);
  return tx(s, corrId, entityId, cmd);
}

try {
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  const hello = parseHello(await nextBlock());
  console.log('HELLO range', hello.min, hello.max, 'sess', hello.sessionId.length, 'certs', hello.certs.length, 'authPub', hello.serverAuthPub.length);
  const ca = hello.certs.at(-1);
  const serverAuthPubRaw = raw32(hello.serverAuthPub);

  // clé d'auth X25519 (pour le DH avec le serveur)
  const auth = nacl.box.keyPair();

  // ClientHello v9 : [v9][0x20][keyHash][1=44 authPub SPKI]
  const authSpki = core.encodePublicKeyDer('X25519', auth.publicKey);
  const hs = Buffer.concat([Buffer.from([0, V]), small(createHash('sha256').update(ca).digest()), small(authSpki)]);
  ws.send(pad(hs));
  console.log('ClientHello v9 envoyé');
  await new Promise(r => setTimeout(r, 250));

  // NEW v9 (Ed25519 sig) : "NEW " [44 edSPKI] [44 xSPKI] '0' 'S' 'T'
  const ed = core.generateEd25519KeyPair(), x = core.generateX25519KeyPair();
  const newCmd = Buffer.concat([Buffer.from('NEW '), small(core.encodePublicKeyDer('Ed25519', ed.publicKey)), small(core.encodePublicKeyDer('X25519', x.publicKey)), Buffer.from('0SF')]);
  const cn = randomBytes(24);
  ws.send(pad(sigTx(ed.secretKey, hello.sessionId, cn, new Uint8Array(0), newCmd)));
  const idsBlock = await nextBlock();
  const ids = core.decodeTransportBlock(V, idsBlock, { kind: 'broker', sessionId: hello.sessionId }).map(t => t.message).find(m => m.type === 'IDS');
  console.log('NEW ->', ids ? `IDS rcv=${ids.rcvId.length}b snd=${ids.sndId.length}b dh=${ids.rcvPublicDhKey.length}b` : 'pas IDS');
  if (!ids) process.exit(0);

  // SUB (entity = rcvId) signature Ed25519
  const subCmd = Buffer.from('SUB');
  const cs = randomBytes(24);
  ws.send(pad(sigTx(ed.secretKey, hello.sessionId, cs, ids.rcvId, subCmd)));
  let rb = await nextBlock().catch(() => null);
  console.log('SUB ->', rb ? core.decodeTransportBlock(V, rb, { kind: 'broker', sessionId: hello.sessionId }).map(t => t.message.type + ' ' + txt(t.commandBytes || new Uint8Array(), 30)).join(' | ') : 'aucune rep');

  // SKEY (entity = rcvId) : autorise une clé d'expéditeur
  const sndEd = core.generateEd25519KeyPair();
  const skeyCmd = Buffer.concat([Buffer.from('SKEY '), small(core.encodePublicKeyDer('Ed25519', sndEd.publicKey))]);
  const ck = randomBytes(24);
  ws.send(pad(sigTx(sndEd.secretKey, hello.sessionId, ck, ids.rcvId, skeyCmd)));
  rb = await nextBlock().catch(() => null);
  console.log('SKEY ->', rb ? core.decodeTransportBlock(V, rb, { kind: 'broker', sessionId: hello.sessionId }).map(t => t.message.type + ' ' + txt(t.commandBytes || new Uint8Array(), 30)).join(' | ') : 'aucune rep');

  // SEND vers notre propre sndId, CbAuth avec la clé d'auth
  const sendCmd = Buffer.concat([Buffer.from('SEND '), Buffer.from('F '), Buffer.from('nephtys-e2e')]);
  const cd = randomBytes(24);
  ws.send(pad(tx(new Uint8Array(0), cd, ids.sndId, sendCmd)));
  rb = await nextBlock().catch(() => null);
  if (rb) {
    for (const t2 of core.decodeTransportBlock(V, rb, { kind: 'broker', sessionId: hello.sessionId })) {
      const m = t2.message;
      console.log('SEND ->', m.type, m.type === 'MSG' ? `msgId=${m.msgId?.length}b body=${m.body?.length ?? m.encryptedBody?.length}b` : '');
      // Déchiffrement Layer B (serveur -> destinataire) : nacl.box.open(body, msgId, srvDhPub, x.priv)
      if (m.type === 'MSG') {
        try {
          const srvDh = raw32(ids.rcvPublicDhKey);
          const body = m.body ?? m.encryptedBody;
          const plain = nacl.box.open(body, m.msgId, srvDh, x.secretKey);
          console.log('   déchiffré:', plain ? txt(plain, 60) : 'échec');
        } catch (e) { console.log('   decrypt err', e.message); }
      }
    }
  }

  // GET (entity = rcvId) pour récupérer notre message
  const getCmd = Buffer.from('GET');
  const cg = randomBytes(24);
  ws.send(pad(sigTx(ed.secretKey, hello.sessionId, cg, ids.rcvId, getCmd)));
  rb = await nextBlock().catch(() => null);
  console.log('GET ->', rb ? core.decodeTransportBlock(V, rb, { kind: 'broker', sessionId: hello.sessionId }).map(t => t.message.type + ' ' + txt(t.commandBytes || new Uint8Array(), 40)).join(' | ') : 'aucune rep');
} catch (e) { console.log('ERREUR', e.message); }
finally { try { ws.close(); } catch { } process.exit(0); }