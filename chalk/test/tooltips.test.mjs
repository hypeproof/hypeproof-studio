import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { TOOLTIP_CSS, TOOLTIP_SCRIPT } from '../src/lib/tooltips.ts';
const { default: app } = await import('../src/index.ts');
for (const route of ['/console','/start','/issuer','/board','/authoring','/manage','/budgets','/sharing','/learn']) {
  const response = await app.fetch(new Request('https://chalk.test'+route), { ENVIRONMENT:'test' });
  assert.equal(response.status,200,route);
  const html = await response.text();
  assert.ok(html.includes(`<style>${TOOLTIP_CSS}</style>`), route + ' tooltip styles');
  assert.ok(html.includes(`<script>${TOOLTIP_SCRIPT}</script>`), route + ' tooltip runtime');
  assert.ok(html.indexOf(TOOLTIP_CSS) > html.indexOf('<style data-design-tokens>'), route + ' tokens before tooltip');
  if (route === '/manage') assert.ok(html.includes("main.setAttribute('data-hp-tooltip',main.textContent)"));
}
console.log('PASS tooltips on all nine actual Chalk routes');
