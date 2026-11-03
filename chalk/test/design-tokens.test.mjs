import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { checkTransport, tokenCss } from '../../scripts/sync-design-tokens.mjs';
const { default: app } = await import('../src/index.ts');
checkTransport();
const expected = tokenCss();
for (const route of ['/console','/start','/issuer','/board','/authoring','/manage','/budgets','/sharing','/learn']) {
  const response = await app.fetch(new Request('https://chalk.test'+route), { ENVIRONMENT:'test' });
  assert.equal(response.status,200,route);
  assert.match(response.headers.get('content-type'),/text\/html/);
  const html=await response.text();
  assert.equal(html.match(/<style data-design-tokens>/g)?.length,1,route);
  assert.equal(html.match(/<style data-design-tokens>([\s\S]*?)<\/style>/)?.[1],expected,route);
  assert.ok(html.indexOf('<style data-design-tokens>')<html.indexOf('<style>',html.indexOf('</style>')),route+' ordering');
  // Served page, after every CSS module a route injects: no colour literal outside the token block.
  const local=html.replace(/<style data-design-tokens>[\s\S]*?<\/style>/,'');
  for (const m of local.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>|\bstyle\s*=\s*"([^"]*)"/gi)) assert.doesNotMatch((m[1]??m[2]).replace(/\/\*[\s\S]*?\*\//g,''),/#[\da-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?)\s*\(/i,route+': colour literal in served page CSS');
}
console.log('design-tokens: all nine real Chalk routes serve canonical CSS before local rules');
