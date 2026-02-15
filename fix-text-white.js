import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Patterns à remplacer - seulement les textes qui doivent s'adapter au thème
const replacements = [
  // Titres et headers
  { from: 'text-xl font-semibold text-white', to: 'text-xl font-semibold text-text-primary' },
  { from: 'text-xl font-medium text-white', to: 'text-xl font-medium text-text-primary' },
  { from: 'text-2xl font-bold text-white', to: 'text-2xl font-bold text-text-primary' },
  { from: 'text-3xl font-bold text-white', to: 'text-3xl font-bold text-text-primary' },
  { from: 'text-lg font-semibold text-white', to: 'text-lg font-semibold text-text-primary' },
  
  // Noms et labels
  { from: 'font-medium text-white', to: 'font-medium text-text-primary' },
  { from: 'font-semibold text-white', to: 'font-semibold text-text-primary' },
  
  // Inputs
  { from: 'text-white text-sm', to: 'text-text-primary text-sm' },
  { from: 'bg-bg-hover text-white', to: 'bg-bg-hover text-text-primary' },
  { from: 'bg-bg-surface text-white', to: 'bg-bg-surface text-text-primary' },
  
  // Textes généraux qui doivent s'adapter
  { from: 'truncate text-white', to: 'truncate text-text-primary' },
  { from: 'text-white truncate', to: 'text-text-primary truncate' },
];

function processFile(filePath) {
  let content = readFileSync(filePath, { encoding: 'utf8' });
  let modified = false;
  let changes = [];
  
  for (const { from, to } of replacements) {
    const regex = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = content.match(regex);
    if (matches) {
      content = content.replaceAll(regex, to);
      modified = true;
      changes.push(`  ${from} -> ${to} (${matches.length} occurrences)`);
    }
  }
  
  if (modified) {
    writeFileSync(filePath, content, { encoding: 'utf8' });
    console.log(`✅ Fixed: ${filePath}`);
    changes.forEach(c => console.log(c));
    console.log('');
    return 1;
  }
  return 0;
}

function processDirectory(dirPath) {
  let count = 0;
  const items = readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = join(dirPath, item);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
      count += processDirectory(fullPath);
    } else if (item.endsWith('.tsx') || item.endsWith('.ts')) {
      count += processFile(fullPath);
    }
  }
  
  return count;
}

console.log('🔧 Fixing text-white classes...\n');
console.log('Replacing hardcoded text-white with text-text-primary...\n');
const fixed = processDirectory('./src');
console.log(`\n✨ Fixed ${fixed} files!`);

if (fixed === 0) {
  console.log('\n⚠️  No text-white patterns found to replace.');
}