// Sonde native SMP v15 — format EXACT (spec smpmq).
// handshake: [word16 v][1][32 keyHash][ 'F' ]   (clientKey omis => pas de bloc chiffré)
// NEW:       "NEW " [1=44 Ed25519 SPKI] [1=44 X25519 SPKI] '0'(auth) 'S'(submode) "1M0"
// signature: ed25519 over  [1=32 sessionId][1=24 corrId][1=0 entityId] NEW
import tls from 'node:tls';
import { createHash, X509Certificate } from 'node:crypto';
import * as core from '../src/lib/smpweb/browser-smp-core.mjs';

const HOST = 'smp10.smp.im', PORT = 5223;
const small = (b) => Buffer.concat([Buffer.from([b.length]), Buffer.from(b)]);

function readBlock(stream, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => { off(); reject(new Error('timeout')); }, timeoutMs);
    function off() { clearTimeout(t); stream.off('data', onData); stream.off('error', onErr); }
    function onErr(e) { off(); reject(e); }
    function onData(c) { buf = Buffer.concat([buf, c]); if (buf.length >= 16384) { off(); resolve(Buffer.from(buf.subarray(0, 16384))); } }
    stream.on('data', onData); stream.on('error', onErr);
  });
}
function connect() {
  return new Promise((res, rej) => {
    const s = tls.connect({ host: HOST, port: PORT, servername: HOST, ALPNProtocols: ['smp/1'], rejectUnauthorized: false }, () => res(s));
    s.on('error', rej);
  });
}
function parseHello(block) {
  const L = block.readUInt16BE(0);
  const p = block.subarray(2, 2 + L);
  const min = p.readUInt16BE(0), max = p.readUInt16BE(2), sl = p[4];
  const sessionId = p.subarray(5, 5 + sl);
  const chain = p.subarray(5 + sl);
  const certs = []; let off = 1; // 1-byte cert count
  const count = chain[0];
  for (let i = 0; i < count; i++) {
    const len = chain.readUInt16BE(off); off += 2;
    certs.push(chain.subarray(off, off + len)); off += len;
  }
  return { min, max, sessionId, certs, tail: chain.subarray(off) };
}

async function attempt(keyHash, label) {
  const s = await connect();
  try {
    const hello = parseHello(await readBlock(s));
    const v = 15;
    let hs = Buffer.concat([Buffer.from([v >> 8, v & 0xff]), small(Buffer.from(keyHash)), Buffer.from('F')]);
    const hsPadded = Buffer.alloc(16384, 0x23); hsPadded.writeUInt16BE(hs.length, 0); hs.copy(hsPadded, 2);
    s.write(hsPadded);
    await new Promise(r => setTimeout(r, 300));

    const ed = core.generateEd25519KeyPair();
    const x = core.generateX25519KeyPair();
    const cmd = Buffer.concat([
      Buffer.from('NEW '),
      small(core.encodePublicKeyDer('Ed25519', ed.publicKey)),
      small(core.encodePublicKeyDer('X25519', x.publicKey)),
      Buffer.from('0'), Buffer.from('S'), Buffer.from('1M0'),
    ]);
    const corrId = Buffer.from(crypto.getRandomValues(new Uint8Array(24)));
    const signed = Buffer.concat([small(hello.sessionId), small(corrId), small(new Uint8Array(0)), cmd]);
    const sig = core.ed25519Sign(ed.secretKey, signed);
    const tx = Buffer.concat([small(sig), small(corrId), small(new Uint8Array(0)), cmd]);
    const body = Buffer.concat([Buffer.from([1]), Buffer.from([tx.length >> 8, tx.length & 0xff]), tx]);
    const block = Buffer.alloc(16384, 0x23); block.writeUInt16BE(body.length, 0); body.copy(block, 2);
    s.write(block);

    const resp = await readBlock(s).catch(() => null);
    if (!resp) { console.log(`[${label}] aucune réponse`); return; }
    const L = resp.readUInt16BE(0);
    let txt = ''; const p = resp.subarray(2, 2 + L);
    for (const b of p.subarray(0, 120)) txt += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
    console.log(`[${label}] RÉPONSE: ${txt}`);
  } finally { s.destroy(); }
}

const s0 = await connect();
const hello = parseHello(await readBlock(s0)); s0.destroy();
console.log('range', hello.min, hello.max, 'sessLen', hello.sessionId.length, 'certs', hello.certs.length);
const cands = {};
cands['sha256(SPKI leaf)'] = createHash('sha256').update(new X509Certificate(hello.certs[0]).publicKey.export({ type: 'spki', format: 'der' })).digest();
cands['sha256(SPKI CA)'] = createHash('sha256').update(new X509Certificate(hello.certs[hello.certs.length - 1]).publicKey.export({ type: 'spki', format: 'der' })).digest();
cands['sha256(leaf DER)'] = createHash('sha256').update(hello.certs[0]).digest();
cands['sha256(CA DER)'] = createHash('sha256').update(hello.certs[hello.certs.length - 1]).digest();

for (const [l, k] of Object.entries(cands)) { try { await attempt(k, l); } catch (e) { console.log(`[${l}] ERR`, e.message); } }
process.exit(0);