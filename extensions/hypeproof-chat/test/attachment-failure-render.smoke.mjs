import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: {
  contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { AttachmentFailures } from './src/AttachmentFailures'; export const render = items => renderToStaticMarkup(React.createElement(AttachmentFailures, {items, retry:()=>{}, remove:()=>{}}));`,
  resolveDir: fileURLToPath(new URL('../webview-ui/', import.meta.url)), loader: 'tsx',
}, bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, console, window: {}, process, TextEncoder, TextDecoder, Buffer });
const html = module.exports.render([
  { id:'a', name:'<img src=x onerror=alert(1)>\u202E', reason:'빈 파일이에요. 내용을 저장한 뒤 다시 시도해 주세요.' },
  { id:'b', name:'b.txt', reason:'파일을 읽을 권한이 없어요. 접근 권한을 확인해 주세요.', busy:true },
]);
assert.ok(html.includes('&lt;img'));
assert.ok(!html.includes('<img src=x'));
assert.ok(!html.includes('\u202E'));
assert.equal((html.match(/data-testid="attachment-failure"/g) ?? []).length, 2);
assert.ok(html.includes('이 파일만 다시 시도'));
assert.ok(html.includes('다시 읽는 중…'));
assert.ok(html.includes('disabled=""'));
assert.ok(html.includes('role="alert"'));
console.log('attachment failure render: safe names, separate chips, retry and busy state PASS');
