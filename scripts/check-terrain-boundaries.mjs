import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src/terrain');

function walkTsFiles(root) {
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function findClientImports(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  const offenders = [];
  let match = importPattern.exec(source);
  while (match) {
    const specifier = match[1];
    if (specifier.includes('client/')) {
      offenders.push(specifier);
    }
    match = importPattern.exec(source);
  }
  return offenders;
}

const files = walkTsFiles(ROOT);
const violations = files
  .map((filePath) => ({ filePath, imports: findClientImports(filePath) }))
  .filter((entry) => entry.imports.length > 0);

if (violations.length > 0) {
  console.error('Boundary violations detected (src/terrain importing src/client):');
  for (const violation of violations) {
    console.error(`- ${path.relative(process.cwd(), violation.filePath)} -> ${violation.imports.join(', ')}`);
  }
  process.exit(1);
}

console.log('Boundary check passed: src/terrain does not import src/client modules.');
