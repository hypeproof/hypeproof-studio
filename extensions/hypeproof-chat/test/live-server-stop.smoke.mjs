import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'vscode') return { url: 'data:text/javascript,export const workspace={};', shortCircuit: true };
  if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { LiveServer } = await import('../src/liveServer.ts');
const live = new LiveServer();
let close, force = 0, changes = 0, ended = false;
live.server = { close: callback => { close = callback; }, closeAllConnections: () => force++ };
const listener = live.onChange(() => changes++);
const stop = live.stop().then(() => { ended = true; });
await Promise.resolve(); assert.equal(ended, false); assert.equal(changes, 0); assert.equal(force, 1);
close(); await stop; assert.equal(ended, true); assert.equal(changes, 1);
listener.dispose();
live.server = { close: callback => callback(), closeAllConnections() {} };
await live.stop(); assert.equal(changes, 1);
console.log('live-server-stop: PASS (no confirmation before close callback)');
