// REQ-STUDIO-BRAND-MARKS (CGP-DS-R-032 / REQ-CGP-DS-38): Studio ships only HypeProof marks.
//   node --experimental-strip-types test/brand-marks.smoke.mjs
// Reads the shipped assets themselves (the object of the requirement), not component source:
//   1. every image file Studio packages is an SVG we can read, or an explicitly listed raster;
//   2. no SVG, inline data: image or packaged image names a third-party brand;
//   3. every image the webview imports resolves to an HP brand asset;
//   4. no contributed or host-set codicon is a vendor glyph ($(github), $(copilot), ...);
//   5. the shell icon and editor-watermark installers read only HP sources.
// The rendered startup and empty states are measured by startup-brand-computed.smoke.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EXT, SHIPPED, IMAGE, HP_BRAND, walk, rel, auditFiles, auditImports, auditCodicons, VENDOR } from './lib/brand-marks.mjs';

const files = SHIPPED.flatMap((d) => walk(path.join(ROOT, d)));
assert.ok(files.some((f) => f.endsWith('hypeproof-mark.svg')) && files.some((f) => f.endsWith('chat.svg')), 'the walk reaches the brand and media folders');

// The auditors catch what they claim before their verdict on the real tree is trusted.
const fake = (n) => path.join(ROOT, n);
const fakeText = { [fake('assets/x.svg')]: '<svg><title>ChatGPT</title></svg>', [fake('assets/ok.svg')]: '<svg font-family="-apple-system"><path d="M0 0"/></svg>', [fake('extensions/hypeproof-chat/webview-ui/src/a.css')]: `.x{background:url("data:image/svg+xml,%3Csvg%3E%3Ctitle%3EGitHub%3C/title%3E%3C/svg%3E")}`, [fake('extensions/hypeproof-chat/webview-ui/src/b.css')]: '.x{cursor: pointer}' };
assert.deepEqual(auditFiles([fake('assets/x.svg'), fake('assets/ok.svg'), fake('assets/logo.png'), fake('assets/openai-logo.svg'), fake('extensions/hypeproof-chat/webview-ui/src/a.css'), fake('extensions/hypeproof-chat/webview-ui/src/b.css')], (f) => fakeText[f] ?? '<svg/>').length, 4, 'control: a named SVG, an unreviewed raster, a vendor file name and a vendor data: URI are each caught; the font stack and cursor are not');
assert.deepEqual(auditImports([fake('extensions/hypeproof-chat/webview-ui/src/Logo.tsx')], () => 'import mark from "./claude.svg";\nimport hp from "../../../../assets/brand/hypeproof-mark.svg";').length, 1, 'control: an import outside the HP brand set is caught');
assert.equal(auditCodicons([['m', '"icon": "$(github)" $(copilot~spin) $(globe)']]).length, 2, 'control: vendor codicons are caught, generic ones pass');

const assetFailures = auditFiles(files);
assert.deepEqual(assetFailures, [], 'no third-party brand mark in Studio assets');
const importFailures = auditImports(files.filter((f) => f.includes('/webview-ui/src/')));
assert.deepEqual(importFailures, [], 'webview images come from the HP brand set');
const manifest = fs.readFileSync(path.join(EXT, 'package.json'), 'utf8');
assert.deepEqual(auditCodicons([['package.json', manifest], ...files.filter((f) => /\/src\/.*\.ts$/.test(f)).map((f) => [rel(f), fs.readFileSync(f, 'utf8')])]), [], 'no vendor codicon on a Studio contribution');
const icon = JSON.parse(manifest).contributes.viewsContainers.activitybar.map((c) => c.icon);
assert.ok(icon.every((i) => !VENDOR.test(i)), `activity bar icons are Studio's own: ${icon}`);

// Shell marks: the app icon installer and the editor watermark read only HP sources.
const iconScript = fs.readFileSync(path.join(ROOT, 'scripts/install-brand-assets.sh'), 'utf8');
const sources = [...iconScript.matchAll(/"(hypeproof[^":]+\.svg):(codium[^"]+\.svg)"/g)].map((m) => [m[1], m[2]]);
assert.deepEqual(sources.map(([, d]) => d).sort(), ['codium_clt.svg', 'codium_cnl.svg', 'codium_cnl_w80_b8.svg'], 'every VSCodium icon source is replaced');
for (const [s] of sources) assert.ok(HP_BRAND.includes(`assets/brand/${s}`) && fs.existsSync(path.join(ROOT, 'assets/brand', s)), `${s} is an HP brand asset`);
const shell = fs.readFileSync(path.join(ROOT, 'scripts/install-shell-brand.mjs'), 'utf8');
assert.match(shell, /assets\/brand\/hypeproof-watermark\.svg/, 'the empty-editor watermark is the HP watermark');
console.log(`PASS brand marks: ${files.filter((f) => IMAGE.test(f)).length} packaged images, inline data: images, webview imports, codicons and shell icon sources carry only HP marks`);
