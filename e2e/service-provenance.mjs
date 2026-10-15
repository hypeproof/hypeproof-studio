// Attribute Service evidence to the installed, version-pinned public package.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageFile = fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/package.json'));
const root = path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/src/index.ts'))));

export function serviceSourceManifest() {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error('Unexpected non-file in public Service source: ' + name);
    }
  }
  walk('src');
  files.push('schema.sql', 'wrangler.toml');
  files.sort();
  const hash = createHash('sha256');
  for (const name of files) hash.update(name + '\0').update(readFileSync(path.join(root, name)));
  const metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
  return {
    package: metadata.name,
    version: metadata.version,
    source_files: files,
    source_sha256: hash.digest('hex'),
    scope: 'Installed public Service src/, schema.sql and wrangler.toml; Studio SHA identifies the App consumer separately.',
  };
}
