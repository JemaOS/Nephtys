import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Shared function to process a file with given replacements
function processFile(filePath, replacements) {
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

// Shared function to process a directory recursively
function processDirectory(dirPath, fileHandler) {
  let count = 0;
  const items = readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = join(dirPath, item);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
      count += processDirectory(fullPath, fileHandler);
    } else if (item.endsWith('.tsx') || item.endsWith('.ts')) {
      count += fileHandler(fullPath);
    }
  }
  
  return count;
}

export { processFile, processDirectory };
