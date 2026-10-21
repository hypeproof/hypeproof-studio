// CGP-KNOW-D-006 — CSS declarations of the outbound dialog (rendered geometry needs Chromium; see the classroom browser runs).
import assert from 'node:assert/strict';
import { readDesignFile } from './lib/design-token-values.mjs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const css = require('postcss').parse(readDesignFile(new URL('../webview-ui/src/outboundDialog.css', import.meta.url)));
function declarations(selector) { const out = {}; css.walkRules(rule => { if (rule.parent.type === 'root' && rule.selectors.includes(selector)) rule.walkDecls(d => out[d.prop] = d.value); }); return out; }
const dialog = declarations('.hps-outbound'), box = declarations('.hps-outbound-excluded'), actions = declarations('.hps-outbound-actions'), button = declarations('.hps-outbound-actions button');
assert.match(box.border, /^2px solid currentColor$/, 'exclusion box border follows the text colour');
function luminance(hex) { const rgb = hex.match(/[0-9a-f]{2}/gi).map(x => parseInt(x, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; }
for (const [fg, bg] of [['e1e1e1', '202226'], ['cccccc', '1f1f1f'], ['3b3b3b', 'ffffff']]) { const a = luminance(fg), b = luminance(bg); assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, 'exclusion border contrast ≥ 3:1'); }
assert.equal(dialog.width, 'min(560px, calc(100vw - 24px))'); assert.equal(dialog['max-height'], 'calc(100vh - 24px)'); assert.equal(dialog.overflow, 'auto');
assert.equal(dialog['overflow-wrap'], 'anywhere'); assert.equal(dialog['font-size'], 'var(--hp-text-caption)'); assert.equal(actions['flex-wrap'], 'wrap');
assert.ok(parseFloat(declarations('.hps-outbound-item')['min-height']) >= 44, 'checkbox row target'); assert.ok(parseFloat(button['min-height']) >= 44); assert.ok(parseFloat(button['min-width']) >= 44);
assert.ok(declarations('.hps-outbound-actions .hps-outbound-send').background.includes('--vscode-button-background'), '보내기 is the primary action');
const memory = declarations('.hps-outbound-memory'), summary = declarations('.hps-outbound-memory summary');
assert.ok(parseFloat(summary['min-height']) >= 44, 'memory group summary is a 44px target (DES-KNOW-51)'); assert.equal(summary['box-sizing'], 'border-box'); assert.equal(summary.cursor, 'pointer');
assert.match(memory['border-top'], /^1px solid currentColor$/, 'memory group separated by the text colour');
let forced = false; css.walkAtRules('media', m => { if (m.params === '(forced-colors: active)') m.walkDecls('border-color', d => { if (d.value === 'CanvasText') forced = true; }); }); assert.ok(forced);
console.log('PASS outbound dialog CSS: memory group target, exclusion contrast, containment, wrapping, targets, primary action, forced colours');
