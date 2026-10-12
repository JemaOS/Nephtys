// E2E natif SMP v15 via le pont public (WS -> TLS SimpleX).
// Usage : node scripts/native-smp-e2e.mjs
import { createHash, X509Certificate, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import * as core from '../src/lib/simplexweb/browser-smp-core.mjs';

const URL = process.env.BRIDGE || 'wss://78-232-3-78.sslip.io/simplex';
const V = 15;

function parseHello(block) {
  const L = block.readUInt16BE(0);
  const p = block.subarray(2, 2 + L);
  const min = p.readUInt16BE(0), max = p.readUInt16BE(2), sl = p[4];
  const sessionId = p.subarray(5, 5 + sl);
  const chain = p.subarray(5 + sl);
  const count = chain[0]; let off = 1; const certs = [];
  for (let i = 0; i < count; i++) { const len = chain.readUInt16BE(off); off += 2; certs.push(chain.subarray(off, off + len)); off += len; }
  return { min, max, sessionId, certs };
}
function padBlock(payload) { const b = Buffer.alloc(16384, 0x23); b.writeUInt16BE(payload.length, 0); Buffer.from(payload).copy(b, 2); return b; }
function toText(bytes, n = 200) { let s = ''; for (const b of bytes.subarray(0, n)) s += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.'; return s; }

const ws = new WebSocket(URL);
ws.binaryType = 'arraybuffer';
let buf = Buffer.alloc(0);
const waiters = [];
ws.onmessage = (e) => { buf = Buffer.concat([buf, Buffer.from(e.data)]); for (const w of [...waiters]) w(); };

function nextBlock(timeout = 8000) {
  return new Promise((resolve, reject) => {
    const tryRead = () => { if (buf.length >= 16384) { const b = buf.subarray(0, 16384); buf = buf.subarray(16384); cleanup(); resolve(b); } };
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    function cleanup() { clearTimeout(t); const i = waiters.indexOf(tryRead); if (i >= 0) waiters.splice(i, 1); }
    waiters.push(tryRead); tryRead();
  });
}

try {
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  console.log('WS OPEN', URL);

  const hello = parseHello(await nextBlock());
  console.log('HELLO range', hello.min, hello.max, 'certs', hello.certs.length);

  const ca = hello.certs[hello.certs.length - 1];
  const keyHash = createHash('sha256').update(ca).digest();
  const hs = core.encodeClientHandshake({ version: V, keyHash, proxyServer: false });
  ws.send(padBlock(hs));
  console.log('handshake envoyé (v15, keyHash len', keyHash.length, ')');
  await new Promise(r => setTimeout(r, 400));

  // NEW (createQueue)
  const ed = core.generateEd25519KeyPair();
  const x = core.generateX25519KeyPair();
  const cmd = core.encodeCommand(V, {
    type: 'NEW',
    rcvPublicVerifyKey: core.encodePublicKeyDer('Ed25519', ed.publicKey),
    rcvPublicDhKey: core.encodePublicKeyDer('X25519', x.publicKey),
    subscriptionMode: 'subscribe',
    queueMode: 'contact',
  });
  const corrId = randomBytes(24);
  const stx = core.encodeSignedTransmission(V, hello.sessionId, {
    commandBytes: cmd, corrId: new Uint8Array(corrId), queueId: new Uint8Array(), privateKey: ed.secretKey,
  });
  const newBlock = core.encodeTransportBlock(V, [stx]); // déjà paddé 16384
  ws.send(newBlock);

  const respBlock = await nextBlock();
  const txs = core.decodeTransportBlock(V, respBlock, { kind: 'broker', sessionId: hello.sessionId });
  for (const t of txs) {
    const m = t.message;
    console.log('RÉPONSE:', m.type, m.type === 'IDS' ? `rcvId=${m.rcvId.length}b sndId=${m.sndId.length}b dh=${m.rcvPublicDhKey.length}b` : toText(t.commandBytes || new Uint8Array()));
    if (m.type === 'IDS') {
      // tentative de SEND (entity = sndId), signature ed25519 (clé de NEW)
      const sendCmd = core.encodeCommand(V, { type: 'SEND', flags: { notification: false }, body: new TextEncoder().encode('nephtys-test') });
      const c2 = randomBytes(24);
      const stx2 = core.encodeSignedTransmission(V, hello.sessionId, { commandBytes: sendCmd, corrId: new Uint8Array(c2), queueId: m.sndId, signature: new Uint8Array(0) });
      ws.send(core.encodeTransportBlock(V, [stx2]));
      const rb = await nextBlock().catch(() => null);
      if (rb) {
        const srvDh = Buffer.from(m.rcvPublicDhKey).subarray(-32);
        const rx = core.decodeTransportBlock(V, rb, { kind: 'broker', sessionId: hello.sessionId });
        for (const t2 of rx) {
          const mm = t2.message;
          if (mm.type === 'MSG') {
            const plain = nacl.box.open(mm.body, mm.msgId, srvDh, x.secretKey);
            console.log('DECRYPT:', plain ? 'OK -> ' + new TextDecoder().decode(plain.subarray(14, 14 + 11)) : 'ÉCHEC');
          } else console.log('SEND ->', mm.type, toText(t2.commandBytes || new Uint8Array()));
        }
      } else console.log('SEND -> aucune réponse');
    }
  }
  console.log('createQueue OK ✔');
} catch (e) {
  console.log('ERREUR', e.message);
} finally {
  ws.close();
  process.exit(0);
}