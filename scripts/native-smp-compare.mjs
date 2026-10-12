// Compare : envoi direct TLS vs via pont WS, octets IDENTIQUES (clés fixes).
import tls from 'node:tls';
import { createHash, X509Certificate } from 'node:crypto';
import * as core from '../src/lib/simplexweb/browser-smp-core.mjs';

const CA_DER = process.env.CA || null;
const small = b => Buffer.concat([Buffer.from([b.length]), Buffer.from(b)]);
const pad = p => { const b = Buffer.alloc(16384, 0x23); b.writeUInt16BE(p.length, 0); Buffer.from(p).copy(b, 2); return b; };

function parseHello(block) {
  const L = block.readUInt16BE(0), p = block.subarray(2, 2 + L);
  const min = p.readUInt16BE(0), max = p.readUInt16BE(2), sl = p[4], sid = p.subarray(5, 5 + sl);
  const chain = p.subarray(5 + sl); const count = chain[0]; let off = 1; const certs = [];
  for (let i = 0; i < count; i++) { const len = chain.readUInt16BE(off); off += 2; certs.push(chain.subarray(off, off + len)); off += len; }
  return { min, max, sid, certs };
}
function build(sessionId, keyHash) {
  const hs = Buffer.concat([Buffer.from([0, 15]), small(Buffer.from(keyHash)), Buffer.from('F')]);
  const ed = core.generateEd25519KeyPair(new Uint8Array(32).fill(7));
  const x = core.generateX25519KeyPair(new Uint8Array(32).fill(9));
  const cmd = Buffer.concat(['NEW ', small(core.encodePublicKeyDer('Ed25519', ed.publicKey)), small(core.encodePublicKeyDer('X25519', x.publicKey)), '0', 'S', '1M0'].map(String => Buffer.from(String)));
  const corrId = Buffer.alloc(24, 3);
  const signed = Buffer.concat([small(sessionId), small(corrId), small(new Uint8Array(0)), cmd]);
  const sig = core.ed25519Sign(ed.secretKey, signed);
  const tx = Buffer.concat([small(sig), small(corrId), small(new Uint8Array(0)), cmd]);
  const body = Buffer.concat([Buffer.from([1]), Buffer.from([tx.length >> 8, tx.length & 0xff]), tx]);
  return { hs: pad(hs), newBlock: pad(body) };
}
const tag = b => { const L = b.readUInt16BE(0); let s = ''; for (const x of b.subarray(2, 2 + Math.min(L, 120))) s += (x >= 32 && x < 127) ? String.fromCharCode(x) : '.'; return s; };

async function viaDirect() {
  return new Promise((res) => {
    const s = tls.connect({ host: 'smp10.simplex.im', port: 5223, servername: 'smp10.simplex.im', ALPNProtocols: ['smp/1'], rejectUnauthorized: false });
    let buf = Buffer.alloc(0), phase = 0, hello = null;
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (phase === 0 && buf.length >= 16384) { phase = 1; hello = parseHello(buf.subarray(0, 16384)); buf = buf.subarray(16384);
        const kh = createHash('sha256').update(hello.certs.at(-1)).digest();
        const { hs, newBlock } = build(hello.sid, kh); s.write(hs); setTimeout(() => s.write(newBlock), 300);
      } else if (phase === 1 && buf.length >= 16384) { console.log('DIRECT ->', tag(buf.subarray(0, 16384))); s.destroy(); res(); }
    });
    s.on('error', e => { console.log('DIRECT ERR', e.message); res(); });
    setTimeout(() => { console.log('DIRECT timeout'); s.destroy(); res(); }, 9000);
  });
}
async function viaBridge() {
  return new Promise((res) => {
    const w = new WebSocket('ws://127.0.0.1:8098'); w.binaryType = 'arraybuffer';
    let buf = Buffer.alloc(0), phase = 0, hello = null;
    w.onmessage = e => {
      buf = Buffer.concat([buf, Buffer.from(e.data)]);
      if (phase === 0 && buf.length >= 16384) { phase = 1; hello = parseHello(buf.subarray(0, 16384)); buf = buf.subarray(16384);
        const kh = createHash('sha256').update(hello.certs.at(-1)).digest();
        const { hs, newBlock } = build(hello.sid, kh); w.send(hs); setTimeout(() => w.send(newBlock), 300);
      } else if (phase === 1 && buf.length >= 16384) { console.log('PONT   ->', tag(buf.subarray(0, 16384))); w.close(); res(); }
    };
    w.onerror = () => { console.log('PONT ERR'); res(); };
    setTimeout(() => { console.log('PONT timeout'); try { w.close(); } catch { } res(); }, 9000);
  });
}
await viaDirect();
await viaBridge();
process.exit(0);