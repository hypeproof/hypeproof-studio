// studio#3225 — the PDF text extractor (src/documentRead.ts, pdfjs-dist) reads character maps
// (CID fonts, e.g. Korean) from files at runtime. The packaged extension has no node_modules, so
// they ship next to the bundle as dist/pdfjs/cmaps.
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ext = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = dirname(createRequire(join(ext, 'package.json')).resolve('pdfjs-dist/package.json'));
const out = join(ext, 'dist', 'pdfjs');
rmSync(out, { recursive: true, force: true });
for (const dir of ['cmaps']) cpSync(join(pkg, dir), join(out, dir), { recursive: true });
console.log(`pdfjs data → ${out}`);
