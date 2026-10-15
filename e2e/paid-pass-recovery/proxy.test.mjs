import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createRecoveryProxy } from './proxy.mjs';

const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));
const freePort = async () => {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
};
const control = (port, secret, path, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-hps-recovery-secret': secret } });

test('pause closes a live front connection while the backend remains available, then resume forwards again', async () => {
  let hangingResponse;
  const backend = http.createServer((request, response) => {
    if (request.url === '/hang') { hangingResponse = response; response.writeHead(200); response.write('open'); return; }
    response.writeHead(200, { 'content-type': 'text/plain' }).end('backend-ok');
  });
  const backendPort = await listen(backend), frontPort = await freePort(), controlPort = await freePort(), secret = 'isolated-control';
  const proxy = await createRecoveryProxy({ backendPort, frontPort, controlPort, secret });
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${frontPort}/ready`)).text(), 'backend-ok');
    assert.equal((await fetch(`http://127.0.0.1:${controlPort}/state`)).status, 401);
    const hanging = fetch(`http://127.0.0.1:${frontPort}/hang`).catch(() => null);
    await new Promise(resolve => setTimeout(resolve, 50));
    const started = Date.now();
    const paused = await (await control(controlPort, secret, '/pause', 'POST')).json();
    assert.equal(paused.listening, false);
    assert.ok(Date.now() - started < 2000, 'pause must not wait for an unfinished upstream');
    assert.equal(await (await fetch(`http://127.0.0.1:${backendPort}/ready`)).text(), 'backend-ok');
    await hanging;
    const resumed = await (await control(controlPort, secret, '/resume', 'POST')).json();
    assert.equal(resumed.listening, true);
    assert.equal(await (await fetch(`http://127.0.0.1:${frontPort}/again`)).text(), 'backend-ok');
  } finally {
    hangingResponse?.end();
    await proxy.close();
    await close(backend);
  }
});

test('control bind failure rolls back the already-open front listener', async () => {
  const backend = http.createServer((_request, response) => response.end('ok'));
  const occupied = net.createServer();
  const backendPort = await listen(backend), controlPort = await listen(occupied), frontPort = await freePort();
  try {
    await assert.rejects(createRecoveryProxy({ backendPort, frontPort, controlPort, secret: 'isolated-control' }), /EADDRINUSE/);
    await assert.rejects(fetch(`http://127.0.0.1:${frontPort}/should-be-closed`));
  } finally {
    await close(occupied);
    await close(backend);
  }
});
