#!/usr/bin/env node
// Verify the core-file integrity checksums VS Code bakes into product.json.
//
// product.json `checksums` maps a few core files under Resources/app/out (the
// workbench bundle, its HTML/CSS, the sandbox preload, the extension host) to
// their sha256 (base64, padding stripped). At runtime the integrity service
// recomputes them and, on a mismatch, shows "Your installation appears to be
// corrupt" (src/vs/workbench/services/integrity/electron-browser/integrityService.ts).
//
// Built-in extensions are NOT in that list, so swapping extensions/hypeproof-chat
// (the repack fast path, scripts/repack-mac.sh) cannot break it. This check makes
// that a measured fact on every package instead of an assumption: a repack or
// stamp step that ever touches a listed file fails here, before signing.
//
// Usage: node scripts/check-mac-checksums.mjs "path/to/HypeProof Studio.app"
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const app = process.argv[2];
if (!app) {
  console.error('usage: check-mac-checksums.mjs <App.app>');
  process.exit(2);
}
const appDir = path.join(app, 'Contents/Resources/app');
const product = JSON.parse(fs.readFileSync(path.join(appDir, 'product.json'), 'utf8'));
const checksums = product.checksums ?? {};
const names = Object.keys(checksums);
if (names.length === 0) {
  console.error('product.json has no checksums field; nothing to verify (unexpected for a VS Code build)');
  process.exit(1);
}
let bad = 0;
for (const name of names) {
  const file = path.join(appDir, 'out', name);
  let actual = '<missing>';
  try {
    actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64').replace(/=+$/, '');
  } catch { /* reported below */ }
  if (actual !== checksums[name]) {
    console.error(`checksum mismatch: out/${name} expected ${checksums[name]} got ${actual}`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(`product.json checksums: ${names.length}/${names.length} core files match`);
