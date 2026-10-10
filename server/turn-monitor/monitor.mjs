// Moniteur d'usage TURN : interroge le CLI coturn (localhost) et journalise
// sessions + octets relayés. Lancé par un systemd timer (sortie -> journal).
import net from 'node:net';

const PORT = Number(process.env.CLI_PORT || 5766);
const PASSWORD = process.env.CLI_PASSWORD || '';

const sock = net.connect(PORT, '127.0.0.1');
let buf = '';
let done = false;

function finish(error) {
  if (done) return;
  done = true;
  const lines = buf.split('\n').map(l => l.trim()).filter(Boolean);
  const sessions = lines.filter(l => /^\d+:/.test(l));
  const out = {
    ts: new Date().toISOString(),
    sessionCount: sessions.length,
    sessions: sessions.slice(0, 50),
  };
  if (error && sessions.length === 0) out.error = error;
  console.log(JSON.stringify(out));
}

sock.on('connect', () => {
  if (PASSWORD) sock.write(PASSWORD + '\n');
  sock.write('ps\n');
});
sock.on('data', (d) => { buf += d.toString('utf8'); });
sock.on('close', () => finish());
sock.on('error', (e) => finish(e.message));
setTimeout(() => { try { sock.destroy(); } catch { /* ignore */ } finish(); }, 2500);
