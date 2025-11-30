import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Mapping des couleurs hardcodées vers les nouvelles classes
const colorMappings = {
  // Fonds
  'bg-\\[#0b141a\\]': 'bg-bg-primary',
  'bg-\\[#111b21\\]': 'bg-bg-secondary',
  'bg-\\[#202c33\\]': 'bg-bg-surface',
  'bg-\\[#2a3942\\]': 'bg-bg-hover',
  
  // Textes
  'text-\\[#e9edef\\]': 'text-text-primary',
  'text-\\[#8696a0\\]': 'text-text-secondary',
  'text-\\[#667781\\]': 'text-text-tertiary',
  'text-\\[#d1d7db\\]': 'text-text-secondary',
  'text-\\[#54656f\\]': 'text-text-secondary',
  
  // Bordures
  'border-\\[#2a3942\\]': 'border-bg-hover',
  'border-\\[#202c33\\]': 'border-bg-surface',
  
  // Accent
  'bg-\\[#6b6fdb\\]': 'bg-accent',
  'text-\\[#6b6fdb\\]': 'text-accent',
  'border-\\[#6b6fdb\\]': 'border-accent',
  
  // Autres couleurs de fond possibles
  'bg-\\[#f0f2f5\\]': 'bg-bg-primary',
  'bg-\\[#ffffff\\]': 'bg-bg-secondary',
  'bg-\\[#f5f6f6\\]': 'bg-bg-hover',
  
  // Autres couleurs de texte possibles
  'text-\\[#111b21\\]': 'text-text-primary',
};

function processFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  let modified = false;
  let replacements = [];
  
  for (const [oldClass, newClass] of Object.entries(colorMappings)) {
    const regex = new RegExp(oldClass, 'g');
    const matches = content.match(regex);
    if (matches) {
      content = content.replace(regex, newClass);
      modified = true;
      replacements.push(`  ${oldClass} -> ${newClass} (${matches.length} occurrences)`);
    }
  }
  
  if (modified) {
    writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed: ${filePath}`);
    replacements.forEach(r => console.log(r));
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

console.log('🔧 Fixing theme colors...\n');
console.log('Searching for hardcoded colors in .ts and .tsx files...\n');
const fixed = processDirectory('./src');
console.log(`\n✨ Fixed ${fixed} files!`);

if (fixed === 0) {
  console.log('\n⚠️  No hardcoded colors found. This could mean:');
  console.log('   - Colors have already been fixed');
  console.log('   - The color patterns don\'t match');
  console.log('   - Files are in a different location');
}