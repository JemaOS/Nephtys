// Test XFTP e2e (env-gated) : upload + download via un serveur XFTP réel.
// Le navigateur fait du HTTP/2 nativement via fetch ; en Node on fournit un
// `fetchImpl` h2 (une seule connexion par origine, comme le navigateur).
import { describe, it, expect } from 'vitest';
import http2 from 'node:http2';
import { connectBrowserXftpWebClient, uploadXftpWebFile, downloadXftpWebFile } from '../smpweb/browser-xftp-web-client.mjs';

const run = !!process.env.XFTP_E2E;
const URL_ = process.env.XFTP_URL || 'https://xftp2.simplex.im';
const KH = process.env.XFTP_KEYHASH || '5vog2Imy1ExJB_7zDZrkV1KDWi96jYFyy9CL6fndBVw';

function createH2Fetch() {
  const clients = new Map();
  const getClient = (origin: string) => {
    let c = clients.get(origin);
    if (!c || c.closed || c.destroyed) { c = http2.connect(origin); c.on('error', () => clients.delete(origin)); clients.set(origin, c); }
    return c;
  };
  return async (url: string, options: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}) => {
    const u = new URL(url);
    const client = getClient(`${u.protocol}//${u.host}`);
    const headers: Record<string, string> = { ':method': options.method || 'GET', ':path': u.pathname + u.search };
    for (const [k, v] of Object.entries(options.headers || {})) if (!k.startsWith(':')) headers[k.toLowerCase()] = v;
    return await new Promise((resolve, reject) => {
      const req = client.request(headers);
      const chunks: Buffer[] = [];
      let status = 0;
      req.on('response', (h: Record<string, unknown>) => { status = h[':status'] as number; });
      req.on('data', (d: Buffer) => chunks.push(d));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: status >= 200 && status < 300, status,
          async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
          async text() { return buf.toString('utf8'); },
        });
      });
      req.on('error', reject);
      if (options.body) req.write(Buffer.from(options.body));
      req.end();
    });
  };
}

describe.skipIf(!run)('XFTP upload/download (réel)', () => {
  it('envoie puis récupère un fichier identique', async () => {
    const keyHash = Uint8Array.from(atob(KH.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const fetchImpl = createH2Fetch();
    const client = await connectBrowserXftpWebClient({ url: URL_, keyHash, fetchImpl });
    const fileBytes = new TextEncoder().encode('nephtys-xftp-e2e');
    const up = await uploadXftpWebFile(client, fileBytes, { fileName: 'e2e.txt' });
    const dl = await downloadXftpWebFile(client, up.recipientDescription);
    const bytes = dl instanceof Uint8Array ? dl : (dl.content ?? dl.data);
    expect(new TextDecoder().decode(bytes)).toBe('nephtys-xftp-e2e');
  }, 90000);
});