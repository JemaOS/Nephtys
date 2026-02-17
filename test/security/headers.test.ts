import fs from 'node:fs';
import path from 'node:path';

describe('Security Headers Configuration', () => {
  it('should have security headers in vercel.json', () => {
    const vercelConfigPath = path.join(process.cwd(), 'vercel.json');
    if (fs.existsSync(vercelConfigPath)) {
      const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf-8'));
      const headers = vercelConfig.headers || [];
      
      const securityHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'X-XSS-Protection',
        'Content-Security-Policy'
      ];

      const foundHeaders = new Set();
      headers.forEach((h: any) => {
        if (h.headers) {
          h.headers.forEach((header: any) => {
            if (securityHeaders.includes(header.key)) {
              foundHeaders.add(header.key);
            }
          });
        }
      });

      const missing = securityHeaders.filter(h => !foundHeaders.has(h));
      
      // We expect these headers to be present for security.
      // If this test fails, it means we need to add them to vercel.json.
      expect(missing, `Missing security headers: ${missing.join(', ')}`).toEqual([]);
    } else {
      console.warn('vercel.json not found, skipping header check');
    }
  });
});
