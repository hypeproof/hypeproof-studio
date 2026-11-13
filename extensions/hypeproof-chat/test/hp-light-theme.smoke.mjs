// CGP-SHELL-R-016 / CGP-SHELL-D-015 — HP Light and the theme contributions, measured from the shipped files.
// Designed behavior: the extension contributes HP Dark ("HypeProof Studio", vs-dark) and HP Light ("HypeProof Studio
// Light", vs); "시스템 따라가기" uses exactly that pair (preferred dark / light defaults); HP Dark stays the default theme;
// HP Light colours every key HP Dark does, on Paper #F4F6F0 with forest text; body text reaches 7:1, the lime CTA keeps
// forest text at 4.5:1 or more, secondary text and links 4.5:1, control boundaries and the focus ring 3:1.
// Negative controls: a palette that breaks each rule must fail the same checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const pkg = read('package.json'), dark = read('media/hypeproof-theme.json'), light = read('media/hypeproof-light-theme.json');
const themes = pkg.contributes.themes.map((t) => [t.label, t.uiTheme, t.path]);
assert.deepEqual(themes, [['HypeProof Studio', 'vs-dark', './media/hypeproof-theme.json'], ['HypeProof Studio Light', 'vs', './media/hypeproof-light-theme.json']]);
const defaults = pkg.contributes.configurationDefaults;
assert.equal(defaults['workbench.colorTheme'], 'HypeProof Studio', 'HP Dark stays the default');
assert.equal(defaults['workbench.preferredDarkColorTheme'], 'HypeProof Studio');
assert.equal(defaults['workbench.preferredLightColorTheme'], 'HypeProof Studio Light');
assert.equal(light.name, 'HypeProof Studio Light'); assert.equal(light.type, 'light');
assert.deepEqual(Object.keys(light.colors).sort(), Object.keys(dark.colors).sort(), 'HP Light colours exactly the keys HP Dark does');
console.log('PASS theme contributions: HP Dark default, HP Light contributed, system pair named');

const lum = (hex) => { const n = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const RULES = [
  ['foreground', 'editor.background', 7], ['editor.foreground', 'editor.background', 7], ['sideBar.foreground', 'sideBar.background', 7],
  ['input.foreground', 'input.background', 7], ['notifications.foreground', 'notifications.background', 7], ['tab.activeForeground', 'tab.activeBackground', 7],
  ['button.foreground', 'button.background', 4.5], ['badge.foreground', 'badge.background', 4.5], ['button.secondaryForeground', 'button.secondaryBackground', 4.5],
  ['descriptionForeground', 'editor.background', 4.5], ['tab.inactiveForeground', 'tab.inactiveBackground', 4.5], ['input.placeholderForeground', 'input.background', 4.5],
  ['textLink.foreground', 'editor.background', 4.5], ['statusBar.foreground', 'statusBar.background', 4.5], ['titleBar.activeForeground', 'titleBar.activeBackground', 4.5],
  ['focusBorder', 'editor.background', 3], ['input.border', 'input.background', 3], ['widget.border', 'editor.background', 3],
];
const failures = (colors) => RULES.filter(([fg, bg, min]) => !(ratio(colors[fg], colors[bg]) >= min)).map(([fg, bg, min]) => `${fg} on ${bg} ${ratio(colors[fg], colors[bg]).toFixed(2)} < ${min}`);
assert.equal(light.colors['editor.background'], '#F4F6F0', 'Paper background');
assert.deepEqual(failures(light.colors), [], 'HP Light contrast');
assert.ok(ratio(light.colors['editor.foreground'], '#F4F6F0') >= 7);
// Negative controls: each kind of mistake must be caught.
for (const [key, bad] of [['editor.foreground', '#8A9A84'], ['button.foreground', '#F4F6F0'], ['focusBorder', '#D5F279'], ['descriptionForeground', '#A4B09E'], ['input.border', '#D9DFD2']])
  assert.ok(failures({ ...light.colors, [key]: bad }).length > 0, `negative control: ${key} ${bad} must fail`);
const lines = RULES.map(([fg, bg]) => `${fg}/${bg} ${ratio(light.colors[fg], light.colors[bg]).toFixed(2)}`);
console.log('PASS HP Light contrast (' + RULES.length + ' pairs, 5 negative controls): ' + lines.slice(0, 3).join(', ') + ' …');
