// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Transport SMP « Tor WASM » — fait passer des blocs SMP (16384 o) par `tor-js`,
 * donc **via le réseau Tor**, circuits construits dans le navigateur. La
 * passerelle KPS du VPS ne relaie que des octets opaques.
 *
 * On n'adapte PAS le stack SMP : `connectBrowserSmpWebSocketTransport` accepte
 * un `WebSocketImpl` injectable. On fournit un socket fantôme de même surface
 * (readyState/binaryType/send/close/événements), adossé à tor-js :
 *   • down (serveur→client) : GET /smp/down  — réponse streamée (1 flux).
 *   • up   (client→serveur) : POST /smp/up   — **une trame par envoi** (body
 *     non-streamé : le corps streamé n'est pas supporté par tor-js navigateur).
 * Chaque bloc est encadré par une longueur 4 o (HTTP ne préserve pas les
 * frontières de messages).
 */

 

export interface TorSmpTransportOptions {
  /** Base HTTP joignable via Tor (ex. https://relay.exemple). */
  httpBase: string;
  /** Instance TorClient de `tor-js` (déjà bootstrappée). */
  torClient: any;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Retourne une « classe WebSocket » (compatible `WebSocketImpl`) adossée à
 * `tor-js`. Chaque instance ouvre une session down (GET) ; les envois partent en
 * POST individuels sur la même session.
 */
export function createTorSmpWebSocketImpl(opts: TorSmpTransportOptions): any {
  const { httpBase, torClient } = opts;

  return class TorSmpSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState = 0;
    binaryType = 'arraybuffer';

    private readonly sessionId = `nep${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    private readonly listeners: Record<string, Set<(e: any) => void>> = {};
    private readonly abort = new AbortController();
    private buf: Uint8Array = new Uint8Array(0);
    private done = false;

    constructor(_url: string, _protocols?: any) {
      void this.start();
    }

    addEventListener(type: string, l: (e: any) => void): void {
      (this.listeners[type] ||= new Set()).add(l);
    }
    removeEventListener(type: string, l: (e: any) => void): void {
      this.listeners[type]?.delete(l);
    }
    set onopen(l: any) { if (l) this.addEventListener('open', l); }
    set onmessage(l: any) { if (l) this.addEventListener('message', l); }
    set onerror(l: any) { if (l) this.addEventListener('error', l); }
    set onclose(l: any) { if (l) this.addEventListener('close', l); }

    private emit(type: string, ev: any): void {
      const set = this.listeners[type];
      if (!set) return;
      for (const l of [...set]) {
        try { l(ev); } catch { /* listener error ignoré */ }
      }
    }

    private finish(): void {
      if (this.done) return;
      this.done = true;
      this.readyState = 3;
      this.emit('close', {});
    }

    /** Réassemble les blocs encadrés (4 o longueur + payload). */
    private push(chunk: Uint8Array): void {
      this.buf = concat(this.buf, chunk);
      while (this.buf.length >= 4) {
        const len =
          (this.buf[0] << 24) | (this.buf[1] << 16) | (this.buf[2] << 8) | this.buf[3];
        if (this.buf.length < 4 + len) break;
        const block = this.buf.slice(4, 4 + len);
        this.buf = this.buf.slice(4 + len);
        const data = block.buffer.slice(block.byteOffset, block.byteOffset + block.byteLength);
        this.emit('message', { data });
      }
    }

    private async start(): Promise<void> {
      try {
        const down = await torClient.fetch(`${httpBase}/smp/down?id=${this.sessionId}`, {
          signal: this.abort.signal,
        });
        const reader: ReadableStreamDefaultReader<Uint8Array> = down.body.getReader();
        this.readyState = 1;
        this.emit('open', {});
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) this.push(value);
        }
        this.finish();
      } catch (e) {
        this.emit('error', { message: (e as Error)?.message ?? 'tor transport error' });
        this.finish();
      }
    }

    send(block: Uint8Array): void {
      if (this.readyState !== 1) {
        throw new Error('tor smp socket is not open');
      }
      const n = block.length;
      const framed = new Uint8Array(4 + n);
      framed[0] = (n >>> 24) & 0xff;
      framed[1] = (n >>> 16) & 0xff;
      framed[2] = (n >>> 8) & 0xff;
      framed[3] = n & 0xff;
      framed.set(block, 4);
      // POST non-streamé : une trame par envoi (robuste). Le relais encadre déjà.
      void torClient
        .fetch(`${httpBase}/smp/up?id=${this.sessionId}`, {
          method: 'POST',
          body: framed,
          signal: this.abort.signal,
        })
        .catch((e: any) => this.emit('error', { message: e?.message ?? 'tor up error' }));
    }

    close(): void {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      this.abort.abort();
      this.finish();
    }
  };
}

 
