import assert from 'node:assert/strict';
import { readDesignFile } from './lib/design-token-values.mjs';
import postcss from '../webview-ui/node_modules/postcss/lib/postcss.mjs';
import { reduceMotionForced, withReducedMotionAttr } from '../src/motionPreference.ts';
import { motionReduced, applyMotionPreference } from '../webview-ui/src/motion.ts';
const html = '<html lang="ko"><body></body></html>';
assert.equal(reduceMotionForced('on'), true);
assert.equal(reduceMotionForced('off'), false);
for (const v of ['auto', null, undefined, true, 'ON', '<script>']) assert.equal(reduceMotionForced(v), undefined);
for (const v of [true, false]) assert.equal(withReducedMotionAttr(html, v), `<html data-reduced-motion="${v}" lang="ko"><body></body></html>`);
assert.equal(withReducedMotionAttr(html, undefined), html);
const doc = { documentElement: { dataset: {} } };
for (const setting of ['on', 'off', 'auto']) for (const reduce of [true, false]) {
  applyMotionPreference(reduceMotionForced(setting), doc);
  assert.equal(doc.documentElement.dataset.reducedMotion, setting === 'auto' ? undefined : String(setting === 'on'));
  assert.equal(motionReduced(doc, { matchMedia: () => ({ matches: reduce }) }), setting === 'on' || (setting === 'auto' && reduce), `${setting} / OS reduce=${reduce}`);
}
applyMotionPreference('false', doc);
assert.equal(doc.documentElement.dataset.reducedMotion, undefined);
// CSS AST guards preserve declaration values, selector coverage and media context.
const declarations = rule => Object.fromEntries(rule.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value + (n.important ? ' !important' : '')]));
for (const file of ['tokens', 'styles', 'start', 'chatDetails', 'taskWorkspace', 'citationPreview']) {
  const css = postcss.parse(readDesignFile(new URL(`../webview-ui/src/${file}.css`, import.meta.url)));
  let count = 0;
  css.walkAtRules('media', media => {
    if (!media.params.includes('prefers-reduced-motion')) return;
    const value = media.params.includes('no-preference') ? 'false' : 'true';
    media.walkRules(rule => {
      count++;
      for (const selector of rule.selectors) {
        assert.ok(selector.includes(':not([data-reduced-motion])'), `${file}: OS must not override explicit preference`);
        const explicit = selector.replace(':not([data-reduced-motion])', `[data-reduced-motion="${value}"]`);
        const counterpart = css.nodes.find(n => n.type === 'rule' && n.selectors.includes(explicit));
        assert.ok(counterpart, `${file}: explicit ${value} counterpart for ${selector}`);
        assert.deepEqual(declarations(counterpart), declarations(rule), `${file}: host and OS behavior agree`);
      }
    });
  });
  assert.equal(count, { tokens: 1, styles: 12, start: 1, chatDetails: 2, taskWorkspace: 1, citationPreview: 1 }[file], `${file}: every OS fallback rule remains`);
  if (file === 'tokens') {
    const rule = css.nodes.find(n => n.type === 'rule' && n.selectors.includes(':root[data-reduced-motion="true"] *'));
    assert.ok(rule);
    assert.deepEqual(rule.selectors, ['*', '*::before', '*::after'].map(s => `:root[data-reduced-motion="true"] ${s}`));
    assert.deepEqual(declarations(rule), {
      'animation-duration': '0.01ms !important', 'animation-iteration-count': '1 !important',
      'animation-delay': '0s !important', 'transition-duration': '0.01ms !important',
      'transition-delay': '0s !important', 'scroll-behavior': 'auto !important',
    });
  }
}
console.log('reduced-motion: six host/OS combinations and parsed stylesheet guards PASS');

// Supplemental wiring checks; behavior is exercised above and in the mounted App test.
const { readFileSync } = await import('node:fs');
const provider = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
assert.ok(provider.includes('return withReducedMotionAttr(html, reduceMotionForced(vscode.workspace.getConfiguration("workbench").get("reduceMotion")));'));
assert.ok(provider.includes('reduceMotion: reduceMotionForced(vscode.workspace.getConfiguration("workbench").get("reduceMotion"))'));
const extension = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
assert.ok(extension.includes('if (event.affectsConfiguration("workbench.reduceMotion")) void provider.refreshConfig();'));
