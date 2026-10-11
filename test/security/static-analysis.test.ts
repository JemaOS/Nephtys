import fs from 'node:fs';
import path from 'node:path';

// Répertoires ignorés : dépendances, artefacts de build et rapports d'outils.
// Ils contiennent des bundles minifiés (ex. rapports unlighthouse) qui
// déclencheraient des faux positifs.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-ssr',
  '.next',
  'coverage',
  'playwright-report',
  'test-results',
  '.unlighthouse',
  '.vercel',
  'build',
]);

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (!SKIP_DIRS.has(file)) {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

// Secret « évident » : affectation d'une API key / d'un secret à un littéral
// ressemblant à une clé. On exclut les identifiants de type UUID (identifiants,
// pas secrets) et toute valeur hors du jeu de caractères d'une clé (puces,
// texte i18n, etc.).
const SECRET_ASSIGN_RE =
  /(?:api[_-]?key|apikey|client[_-]?secret|secret)\s*[:=]\s*(['"])([A-Za-z0-9+/_-]{16,})\1/gi;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// JWT : trois segments base64url dont l'en-tête commence par `eyJ`. Les clés
// « publiques par conception » (role anon/public, ex. clé anon Supabase) sont
// autorisées ; toute autre (service_role, jeton utilisateur...) est un secret
// qui ne doit pas vivre dans un bundle client.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

describe('Security Static Analysis', () => {
  const rootDir = process.cwd();
  const files = getAllFiles(rootDir);
  const sourceFiles = files.filter(f => {
    if (!(f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx'))) return false;
    const segments = path.relative(rootDir, f).split(path.sep);
    if (segments.includes('test')) return false;
    if (f.includes('.spec.') || f.includes('.test.') || f.includes('.min.')) return false;
    return true;
  });

  it('should not contain dangerouslySetInnerHTML', () => {
    const errors: string[] = [];
    sourceFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('dangerouslySetInnerHTML')) {
        errors.push(`Found dangerouslySetInnerHTML in ${path.relative(rootDir, file)}`);
      }
    });
    // Expect no dangerous patterns
    expect(errors).toEqual([]);
  });

  it('should not contain eval()', () => {
    const errors: string[] = [];
    sourceFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      // Simple regex for eval, avoiding comments or strings might be hard with simple regex,
      // but this catches direct usage.
      if (/\beval\(/.test(content)) {
        errors.push(`Found eval() in ${path.relative(rootDir, file)}`);
      }
    });
    expect(errors).toEqual([]);
  });

  it('should not contain innerHTML / insertAdjacentHTML / document.write', () => {
    const errors: string[] = [];
    sourceFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      if (/\binnerHTML\b/.test(content)) {
        errors.push(`Found innerHTML in ${path.relative(rootDir, file)}`);
      }
      if (/\binsertAdjacentHTML\b/.test(content)) {
        errors.push(`Found insertAdjacentHTML in ${path.relative(rootDir, file)}`);
      }
      if (/\bdocument\.write\b/.test(content)) {
        errors.push(`Found document.write in ${path.relative(rootDir, file)}`);
      }
    });
    expect(errors).toEqual([]);
  });

  it('should not contain hardcoded javascript: URLs', () => {
    const errors: string[] = [];
    sourceFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      // Un littéral d'URL dangereux est entre guillemets/backticks ; les
      // mentions en commentaire (ex. `Rejette javascript:`) ne matchent pas.
      if (/['"`]\s*javascript:/i.test(content)) {
        errors.push(`Found javascript: URL in ${path.relative(rootDir, file)}`);
      }
    });
    expect(errors).toEqual([]);
  });

  it('should not contain obvious hardcoded secrets', () => {
    const errors: string[] = [];
    sourceFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(rootDir, file);

      let m: RegExpExecArray | null;
      SECRET_ASSIGN_RE.lastIndex = 0;
      while ((m = SECRET_ASSIGN_RE.exec(content)) !== null) {
        if (UUID_RE.test(m[2])) continue; // identifiant, pas un secret
        errors.push(`Found hardcoded secret literal in ${rel}`);
      }

      JWT_RE.lastIndex = 0;
      while ((m = JWT_RE.exec(content)) !== null) {
        const role = jwtRole(m[0]);
        if (role === 'anon' || role === 'public') continue; // public par conception
        errors.push(`Found hardcoded JWT (role=${role ?? 'unknown'}) in ${rel}`);
      }
    });
    expect(errors).toEqual([]);
  });

  it('should have a CSP with base-uri, form-action and frame-ancestors', () => {
    const vercelConfigPath = path.join(rootDir, 'vercel.json');
    expect(fs.existsSync(vercelConfigPath)).toBe(true);
    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf-8'));
    const headers = vercelConfig.headers || [];

    let csp = '';
    headers.forEach((h: { headers?: { key?: string; value?: string }[] }) => {
      (h.headers || []).forEach((header) => {
        if (header.key === 'Content-Security-Policy') csp = header.value || '';
      });
    });

    expect(csp, 'Content-Security-Policy header missing in vercel.json').not.toBe('');
    for (const directive of ['base-uri', 'form-action', 'frame-ancestors']) {
      expect(csp, `CSP missing ${directive}`).toContain(directive);
    }
  });
});
