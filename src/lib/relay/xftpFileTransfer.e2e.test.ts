// Intégration e2e : upload via XFTP (descripteur v2) puis download via le
// même chemin que le mode privé (fileTransfer). En navigateur, fetch fait du
// HTTP/2 ; en Node on injecte un fetch h2 (une connexion par origine).
import { describe, it, expect, beforeAll } from 'vitest';
import http2 from 'node:http2';
import { uploadFileXftp, downloadAndDecryptFile, isXftpDescriptor, readBlobBytes, type FileDescriptor } from './fileTransfer';

const run = !!process.env.XFTP_E2E;

function createH2Fetch() {
  const clients = new Map<string, ReturnType<typeof http2.connect>>();
  const get = (origin: string) => {
    let c = clients.get(origin);
    if (!c || c.closed || c.destroyed) { c = http2.connect(origin); c.on('error', () => clients.delete(origin)); clients.set(origin, c); }
    return c;
  };
  return async (url: string, options: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}) => {
    const u = new URL(url);
    const client = get(`${u.protocol}//${u.host}`);
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

describe.skipIf(!run)('mode privé : fichier via XFTP', () => {
  beforeAll(() => { (globalThis as { fetch: unknown }).fetch = createH2Fetch(); });

  it('upload XFTP -> descripteur v2 -> download identique', async () => {
    const file = new Blob([new TextEncoder().encode('fichier-nephtys-xftp')], { type: 'text/plain' });
    Object.defineProperty(file, 'name', { value: 'note.txt' });

    const descriptor = await uploadFileXftp(file);
    expect(isXftpDescriptor(descriptor)).toBe(true);
    expect(descriptor.v).toBe(2);
    expect(descriptor.name).toBe('note.txt');

    const blob = await downloadAndDecryptFile(descriptor as FileDescriptor);
    const out = new TextDecoder().decode(await readBlobBytes(blob));
    expect(out).toBe('fichier-nephtys-xftp');
  }, 90000);
});