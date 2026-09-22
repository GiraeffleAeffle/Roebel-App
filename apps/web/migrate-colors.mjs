import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const srcDir = './src';

// Migration map: [pattern, replacement]
// Order matters - more specific patterns first
const replacements = [
  // Hover backgrounds (must come before base bg replacements)
  [/\bhover:bg-gray-50\b/g, 'hover:bg-accent'],
  [/\bhover:bg-gray-100\b/g, 'hover:bg-accent'],
  [/\bhover:bg-gray-200\b/g, 'hover:bg-accent'],
  [/\bhover:bg-gray-800\b/g, 'hover:bg-foreground/90'],
  [/\bhover:bg-black\b/g, 'hover:bg-foreground'],

  // Hover text
  [/\bhover:text-gray-900\b/g, 'hover:text-foreground'],
  [/\bhover:text-gray-700\b/g, 'hover:text-foreground'],
  [/\bhover:text-gray-600\b/g, 'hover:text-foreground'],
  [/\bhover:text-blue-800\b/g, 'hover:text-primary/80'],
  [/\bhover:text-blue-700\b/g, 'hover:text-primary/80'],
  [/\bhover:text-blue-500\b/g, 'hover:text-primary/80'],

  // Focus states
  [/\bfocus:ring-blue-500\b/g, 'focus:ring-ring'],
  [/\bfocus:border-blue-500\b/g, 'focus:border-ring'],
  [/\bfocus:ring-blue-300\b/g, 'focus:ring-ring'],

  // Disabled states
  [/\bdisabled:bg-gray-300\b/g, 'disabled:bg-muted'],
  [/\bdisabled:bg-gray-200\b/g, 'disabled:bg-muted'],
  [/\bdisabled:text-gray-400\b/g, 'disabled:text-muted-foreground'],
  [/\bdisabled:text-gray-500\b/g, 'disabled:text-muted-foreground'],

  // Backgrounds
  [/\bbg-white\b/g, 'bg-card'],
  [/\bbg-gray-50\b/g, 'bg-muted'],
  [/\bbg-gray-100\b/g, 'bg-muted'],
  [/\bbg-gray-200\b/g, 'bg-muted'],
  [/\bbg-gray-300\b/g, 'bg-muted'],
  [/\bbg-gray-900\b/g, 'bg-foreground'],

  // Text colors
  [/\btext-black\b/g, 'text-foreground'],
  [/\btext-gray-900\b/g, 'text-foreground'],
  [/\btext-gray-800\b/g, 'text-foreground'],
  [/\btext-gray-700\b/g, 'text-foreground'],
  [/\btext-gray-600\b/g, 'text-muted-foreground'],
  [/\btext-gray-500\b/g, 'text-muted-foreground'],
  [/\btext-gray-400\b/g, 'text-muted-foreground'],
  [/\btext-gray-300\b/g, 'text-muted-foreground'],

  // Border colors
  [/\bborder-gray-200\b/g, 'border-border'],
  [/\bborder-gray-300\b/g, 'border-border'],
  [/\bborder-gray-100\b/g, 'border-border'],

  // Divide
  [/\bdivide-gray-200\b/g, 'divide-border'],
  [/\bdivide-gray-100\b/g, 'divide-border'],
  [/\bdivide-gray-700\b/g, 'divide-border'],

  // Ring
  [/\bring-gray-300\b/g, 'ring-border'],
  [/\bring-gray-200\b/g, 'ring-border'],

  // Placeholder
  [/\bplaceholder-gray-400\b/g, 'placeholder-muted-foreground'],
  [/\bplaceholder-gray-500\b/g, 'placeholder-muted-foreground'],

  // Link colors
  [/\btext-blue-600\b/g, 'text-primary'],
  [/\bhover:text-blue-800\b/g, 'hover:text-primary/80'],

  // Focus ring for blue
  [/\bfocus:ring-blue-500\b/g, 'focus:ring-ring'],
  [/\bfocus:border-blue-500\b/g, 'focus:border-ring'],
];

// Files/directories to SKIP (dark-themed components that should keep their dark colors)
const skipPaths = [
  'src/components/landesmeisterschaft/',
  'src/app/ticket/',
  'src/components/proposals/MarkdownRenderer.tsx',
  'src/components/proposals/ProposalEditor.tsx',
];

// Files with explicit dark: variants should be skipped
const skipIfHasDarkVariants = true;

function getAllTsxFiles(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsxFiles(fullPath));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function shouldSkip(filePath) {
  return skipPaths.some(skip => filePath.includes(skip));
}

let totalChanges = 0;
let filesChanged = 0;

const files = getAllTsxFiles(srcDir);
console.log(`Found ${files.length} .tsx/.ts files`);

for (const file of files) {
  if (shouldSkip(file)) {
    console.log(`SKIP: ${file} (in skip list)`);
    continue;
  }

  let content = readFileSync(file, 'utf-8');
  const original = content;

  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }

  if (content !== original) {
    writeFileSync(file, content);
    const changes = original.split('\n').filter((line, i) => line !== content.split('\n')[i]).length;
    console.log(`CHANGED: ${file} (${changes} lines)`);
    totalChanges += changes;
    filesChanged++;
  }
}

console.log(`\nDone! Changed ${filesChanged} files with ${totalChanges} line changes.`);
