/**
 * Configuration centralisée du worker PDF.js.
 *
 * On évite d'importer 3× pdfjs et de redéfinir le worker — une seule source
 * de vérité. On tente d'abord le worker local bundlé par Vite (`?url`).
 * En cas d'échec (Vercel edge cache, CORS, etc.) on peut fallback sur CDN.
 */
import { pdfjs } from 'react-pdf';

const PDFJS_VERSION = pdfjs.version; // ex: "5.4.296"
let workerConfigured = false;

export function configurePDFWorker() {
  if (workerConfigured) return;
  workerConfigured = true;

  // CDN unpkg — fiable, toujours la bonne version, pas de problème
  // de bundling Vite/Vercel avec les workers ESM.
  // pdfjs v4+ requiert un module worker (.mjs) — pas de classic worker.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
}
