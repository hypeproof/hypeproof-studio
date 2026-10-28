// CGP-DS-R-026 (REQ-STUDIO-LOGICAL-CSS): no new margin-left/right, padding-left/right, left or
// right in the component CSS of the Studio webview and Chalk; CGP-DS-D-023 (DES-CGP-DS-29) adds
// text-align: left/right and asymmetric four-value margin/padding/inset. Runs the ratchet lint on the real
// tree, then on planted samples: positive controls must pass, negative controls must fail.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const lintPath = path.join(repo, 'scripts/logical-css-lint.mjs');
const lint = await import(lintPath);

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// 1. The shipped tree passes against the committed baseline, through the CLI CI runs.
const cli = spawnSync(process.execPath, [lintPath], { cwd: repo, encoding: 'utf8' });
ok(cli.status === 0, `logical-css lint must pass on the tree:\n${cli.stdout}${cli.stderr}`);

// 2. Every root is scanned: the lint sees the webview CSS, TSX, Chalk HTML and Chalk TS CSS.
const files = lint.listComponentFiles();
for (const want of [
  'extensions/hypeproof-chat/webview-ui/src/styles.css',
  'extensions/hypeproof-chat/webview-ui/src/ChatPanel.tsx',
  'chalk/src/ui/manage.html',
  'chalk/src/lib/list-rows.ts',
  'chalk/src/lib/typography.css',
]) ok(files.includes(want), `lint must scan ${want}`);
ok(!files.includes('chalk/src/lib/design-tokens.ts'), 'the generated token transport is not authored CSS');
ok(!files.some((f) => f.includes('/webview-ui/styles/')), 'vendored KaTeX CSS is not component CSS');

// 3. The baseline grandfathers exactly what the tree has (no slack a later change could reuse).
const baseline = lint.readBaseline();
const real = lint.tally(files);
const drift = lint.compare(real.counts, baseline, real.where);
ok(drift.added.length === 0 && drift.stale.length === 0, `baseline matches the tree: ${JSON.stringify(drift)}`);

// Planted samples against a planted baseline.
function run(sample, base = {}) {
  const names = Object.keys(sample);
  const { counts, where } = lint.tally(names, (rel) => sample[rel]);
  return lint.compare(counts, base, where);
}
const fails = (name, sample, base) => {
  const r = run(sample, base);
  ok(r.added.length + r.stale.length > 0, `negative control must fail: ${name}`);
  return r;
};
const passes = (name, sample, base) => {
  const r = run(sample, base);
  ok(r.added.length + r.stale.length === 0, `positive control must pass: ${name} ${JSON.stringify(r)}`);
};

const W = 'extensions/hypeproof-chat/webview-ui/src/sample.css';
const H = 'chalk/src/ui/sample.html';
const T = 'chalk/src/lib/sample.ts';
const X = 'extensions/hypeproof-chat/webview-ui/src/Sample.tsx';

// Positive controls.
passes('logical properties', { [W]: '.a { margin-inline-start: 4px; padding-inline: 8px; inset-inline-end: 0; text-align: start }' });
passes('physical words in selectors and comments', { [W]: '/* margin-left: 4px */\n.left:hover, .right { color: red }\n@page :left { margin: 0 }' });
passes('custom properties and other physical-looking names', { [W]: '.a { --gap-left: 4px; scroll-margin-top: 2px; border-left-color: red; top: 0 }' });
passes('an exempt physical declaration with a reason', { [W]: '.a { left: 50%; /* logical-css: physical centred with translateX(-50%), which does not flip */ }' });
passes('a grandfathered declaration stays', { [W]: '.a { margin-left: auto }' }, { [W]: { 'margin-left: auto': 1 } });
passes('a grandfathered declaration moves to another selector', { [W]: '.renamed {\n  margin-left: auto;\n}' }, { [W]: { 'margin-left: auto': 1 } });
passes('JS geometry in a Chalk TS file is not CSS', { [T]: 'export function place(el, x) { el.style.left = x + "px"; return { left: x }; }' });
passes('a Chalk TS non-Css template literal', { [T]: 'export const help = `left: is a word here`;' });
// CGP-DS-D-023 positive controls: logical or symmetric forms of the wider list.
for (const v of ['start', 'end', 'center', 'justify', 'inherit', 'start !important']) {
  passes(`text-align: ${v}`, { [W]: `.a { text-align: ${v} }` });
}
passes('one to three value shorthands are symmetric', { [W]: '.a { margin: 4px; padding: 0 8px; inset: 0 auto 4px }' });
passes('a four-value shorthand with equal left and right', { [W]: '.a { padding: 2px 8px 4px 8px; margin: 0 auto 4px auto; inset: 0 0 0 0 }' });
passes('spaces inside calc() and var() are one component', { [W]: '.a { padding: calc(1px + 2px) var(--gap, 0 4px) calc(1px + 2px) var(--gap, 0 4px) }' });
passes('a logical shorthand pair', { [W]: '.a { padding-block: 2px 4px; padding-inline: 4px 8px; inset-inline: 0 auto }' });
passes('TSX textAlign start and symmetric padding', { [X]: 'export const A = () => <i style={{ textAlign: "start", padding: "0 8px" }} />;' });
passes('a grandfathered text-align stays', { [W]: '.a { text-align: left }' }, { [W]: { 'text-align: left': 1 } });

// Negative controls: every property of the acceptance, in every carrier.
for (const prop of lint.PHYSICAL_PROPERTIES) {
  fails(`new ${prop} in webview CSS`, { [W]: `.a { ${prop}: 4px }` });
}
fails('upper-case property', { [W]: '.a { MARGIN-LEFT: 4px }' });
// CGP-DS-D-023 negative controls.
fails('new text-align: left', { [W]: '.a { text-align: left }' });
fails('new text-align: right', { [W]: '.a { text-align: right }' });
fails('upper-case text-align value with !important', { [W]: '.a { TEXT-ALIGN: LEFT !important }' });
fails('asymmetric four-value padding', { [W]: '.a { padding: 0 8px 0 4px }' });
fails('asymmetric four-value margin', { [W]: '.a { margin: 0 auto 0 0 }' });
fails('asymmetric four-value inset', { [W]: '.a { position: absolute; inset: 0 auto 0 0 }' });
fails('asymmetric shorthand with calc() sides', { [W]: '.a { padding: 0 calc(1px + 2px) 0 calc(2px + 2px) }' });
fails('Chalk style attribute text-align', { [H]: '<td style="text-align: right">1</td>' });
fails('Chalk <style> block asymmetric padding', { [H]: '<style>.row { padding: 0 0 0 12px }</style>' });
fails('Chalk exported Css literal text-align', { [T]: 'export const cellCss = `.c { text-align: left; }`;' });
fails('TSX textAlign left', { [X]: 'export const A = () => <i style={{ textAlign: "left" }} />;' });
fails('TSX asymmetric padding string', { [X]: "export const A = () => <i style={{ padding: '0 0 0 4px' }} />;" });
fails('a grandfathered text-align copied once more', { [W]: '.a { text-align: left }\n.b { text-align: left }' }, { [W]: { 'text-align: left': 1 } });
fails('text-align swapped left to right', { [W]: '.a { text-align: right }' }, { [W]: { 'text-align: left': 1 } });
fails('last declaration without a semicolon, nested rule', { [W]: '.a { &:hover { padding-right: 2px } }' });
fails('inside an @media rule', { [W]: '@media (max-width: 700px) { .a { right: 0; } }' });
fails('Chalk <style> block', { [H]: '<html><head><style>\n.row { padding-right: 8px; }\n</style></head></html>' });
fails('Chalk style attribute', { [H]: '<div style="color: red; margin-left: 4px">x</div>' });
fails('Chalk exported Css template literal', { [T]: 'export const rowCss = `\n.row { left: 0; }\n`;' });
fails('TSX inline style camelCase', { [X]: 'export const A = () => <i style={{verticalAlign: "middle", marginLeft: 4}} />;' });
fails('TSX inline style quoted key', { [X]: 'export const A = () => <i style={{ "padding-right": 4 }} />;' });
fails('TSX inline style left', { [X]: 'export const A = () => <i style={{ position: "absolute", left: 0 }} />;' });
fails('a grandfathered value copied once more', { [W]: '.a { margin-left: auto }\n.b { margin-left: auto }' }, { [W]: { 'margin-left: auto': 1 } });
fails('a grandfathered value swapped for a new one', { [W]: '.a { margin-left: 2px }' }, { [W]: { 'margin-left: auto': 1 } });
fails('a grandfathered value in a new file', { [W]: '.a { margin-left: auto }' }, { 'extensions/hypeproof-chat/webview-ui/src/other.css': { 'margin-left: auto': 1 } });
fails('an exemption marker without a reason', { [W]: '.a { left: 0; /* logical-css: physical */ }' });
fails('an exemption marker on another line', { [W]: '/* logical-css: physical because */\n.a { left: 0; }' });
const stale = fails('a stale baseline entry', { [W]: '.a { color: red }' }, { [W]: { 'margin-left: auto': 1 } });
ok(stale.stale.length === 1 && stale.added.length === 0, 'a removed declaration is reported as stale, not added');

// The finding names the file, line and the logical replacement.
const where = run({ [W]: '.a {\n  color: red;\n  padding-left: 3px;\n}' });
ok(where.added[0]?.lines?.[0] === 3, 'the finding carries the declaration line');
ok(lint.LOGICAL_HINT['padding-left'] === 'padding-inline-start', 'the hint names the logical property');
ok(lint.hintFor('text-align: left') === 'text-align: start' && lint.hintFor('text-align: right!important') === 'text-align: end', 'text-align hints name start/end');
ok(/padding-inline/.test(lint.hintFor('padding: 0 0 0 4px')) && /inset-inline/.test(lint.hintFor('inset: 0 auto 0 0')), 'shorthand hints name the logical shorthands');

// 4. The CLI fails on a planted tree and --update refuses to grow the baseline.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logical-css-'));
try {
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.mkdirSync(path.join(tmp, 'config'));
  fs.mkdirSync(path.join(tmp, 'extensions/hypeproof-chat/webview-ui/src'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'chalk/src'), { recursive: true });
  fs.copyFileSync(lintPath, path.join(tmp, 'scripts/logical-css-lint.mjs'));
  const base = path.join(tmp, 'config/logical-css-baseline.json');
  fs.writeFileSync(base, JSON.stringify({ files: {} }));
  fs.writeFileSync(path.join(tmp, 'extensions/hypeproof-chat/webview-ui/src/a.css'), '.a { margin-right: 4px }');
  const bad = spawnSync(process.execPath, [path.join(tmp, 'scripts/logical-css-lint.mjs')], { cwd: tmp, encoding: 'utf8' });
  ok(bad.status === 1 && /a\.css:1 new physical "margin-right: 4px".*margin-inline-end/.test(bad.stderr), `CLI must fail on a new declaration: ${bad.stderr}`);
  const grow = spawnSync(process.execPath, [path.join(tmp, 'scripts/logical-css-lint.mjs'), '--update'], { cwd: tmp, encoding: 'utf8' });
  fs.writeFileSync(path.join(tmp, 'extensions/hypeproof-chat/webview-ui/src/b.css'), '.b {\n  text-align: right;\n}');
  const ta = spawnSync(process.execPath, [path.join(tmp, 'scripts/logical-css-lint.mjs')], { cwd: tmp, encoding: 'utf8' });
  ok(ta.status === 1 && /b\.css:2 new physical "text-align: right".*text-align: end/.test(ta.stderr), `CLI must fail on a new text-align: ${ta.stderr}`);
  ok(grow.status === 1 && JSON.parse(fs.readFileSync(base, 'utf8')).files && !Object.keys(JSON.parse(fs.readFileSync(base, 'utf8')).files).length, '--update must refuse to grandfather a new declaration');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`logical-css smoke: ${checks} checks passed`);
