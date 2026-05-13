/**
 * Configuration centralisée du worker PDF.js.
 *
 * On évite d'importer 3× pdfjs et de redéfinir le worker — une seule source
 * de vérité. On tente d'abord le worker local bundlé par Vite (`?url`).
 * En cas d'échec (Vercel edge cache, CORS, etc.) on peut fallback sur CDN.
 */
import { pdfjs } from 'react-pdf';

let workerConfigured = false;

export function configurePDFWorker() {
  if (workerConfigured) return;
  workerConfigured = true;

  // Le worker est copié dans public/ lors du build (voir vite.config.ts et
  // le script prebuild). On le charge depuis la même origine → pas de CSP,
  // pas de CORS, pas de dépendance CDN externe.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}
