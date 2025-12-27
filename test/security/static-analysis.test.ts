import fs from 'fs';
import path from 'path';

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== '.next' && file !== 'coverage' && file !== 'playwright-report') {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

describe('Security Static Analysis', () => {
  const rootDir = process.cwd();
  const files = getAllFiles(rootDir);
  const sourceFiles = files.filter(f => 
    (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx')) &&
    !f.includes('test/') && 
    !f.includes('.spec.') &&
    !f.includes('.test.')
  );

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
});
