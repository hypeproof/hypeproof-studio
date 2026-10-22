// CGP-DS-D-025 / DES-CGP-DS-31: parsed stylesheet rules, not source-text matches.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from '../webview-ui/node_modules/postcss/lib/postcss.mjs';
import { checkTransport } from '../../../scripts/sync-design-tokens.mjs';
const src = new URL('../webview-ui/src/', import.meta.url);
const css = postcss.parse(readFileSync(new URL('koreanProse.css', src), 'utf8'));
const prose = ':lang(ko):is(p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, .hps-msg-body, .hps-prose, .hp-mission-sentence, .hp-mission-acceptance, .hps-error-banner-msg, .hps-stop-notice)';
const heading = ':lang(ko):is(h1, h2, h3, h4, h5, h6)';
function value(selector, property) {
  let value;
  css.walkRules(selector, rule => rule.walkDecls(property, decl => { value = decl.value; }));
  return value;
}
for (const [selector, property, expected] of [
  [prose, 'word-break', 'keep-all'], [prose, 'overflow-wrap', 'anywhere'],
  [prose, 'line-break', 'strict'], [heading, 'text-wrap', 'balance'],
  ['p:lang(ko)', 'text-wrap', 'pretty'],
]) assert.equal(value(selector, property), expected, `${selector}: ${property}`);
const workspace = postcss.parse(readFileSync(new URL('taskWorkspace.css', src), 'utf8'));
workspace.walkRules('.tw-sources h3', rule => rule.walkDecls('text-wrap', decl => assert.equal(decl.value, 'balance')));
checkTransport();
assert.ok(readFileSync(new URL('main.tsx', src), 'utf8').includes('import "./koreanProse.css";'), 'Studio loads shared prose CSS');
assert.ok(readFileSync(new URL('../webview-ui/index.html', import.meta.url), 'utf8').includes('<html lang="ko">'));
console.log('korean-prose: five shared declarations, heading override, language and Chalk transport PASS');
