// Lanceur du pont SMP natif (browser WS -> TLS natif SimpleX).
// Usage :
//   SIMPLEX_WEB_SMP_TARGET_HOST=smp10.simplex.im node scripts/smp-native-relay.mjs
import { startSmpNativeTlsRelayFromEnv } from '../src/lib/simplexweb/browser-smp-native-tls-relay.mjs';

const started = startSmpNativeTlsRelayFromEnv();
console.log(`[smp-native-relay] ws://${started.host}:${started.port}${started.options.path} -> ${started.options.target.host}:${started.options.target.port} (ALPN smp/1)`);