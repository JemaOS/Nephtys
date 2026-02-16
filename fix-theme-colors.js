import { processFile, processDirectory } from './fix-utils.js';

// Colors that should use theme tokens
const replacements = [
  // Primary colors
  { from: 'text-gray-100', to: 'text-text-primary' },
  { from: 'text-gray-200', to: 'text-text-secondary' },
  { from: 'text-gray-300', to: 'text-text-tertiary' },
  { from: 'text-gray-400', to: 'text-text-muted' },
  
  // Background variations
  { from: 'bg-gray-900', to: 'bg-bg-surface' },
  { from: 'bg-gray-800', to: 'bg-bg-elevated' },
  { from: 'bg-gray-700', to: 'bg-bg-hover' },
  { from: 'bg-gray-600', to: 'bg-bg-active' },
  
  // Border colors
  { from: 'border-gray-700', to: 'border-border' },
  { from: 'border-gray-600', to: 'border-border' },
  { from: 'border-gray-800', to: 'border-border' },
  
  // Ring colors
  { from: 'ring-gray-600', to: 'ring-ring' },
  { from: 'ring-gray-500', to: 'ring-ring' },
  
  // Accent colors
  { from: 'from-gray-700', to: 'from-bg-elevated' },
  { from: 'to-gray-800', to: 'to-bg-surface' },
];

function handleFile(filePath) {
  return processFile(filePath, replacements);
}

console.log('🔧 Fixing theme colors...\n');
console.log('Replacing hardcoded Tailwind colors with theme tokens...\n');
const fixed = processDirectory('./src', handleFile);
console.log(`\n✨ Fixed ${fixed} files!`);

if (fixed === 0) {
  console.log('\n⚠️  No hardcoded color patterns found to replace.');
}
