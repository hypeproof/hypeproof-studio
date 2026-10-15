import http from 'node:http';

const listen = (server, port) => new Promise((resolve, reject) => {
  const onError = error => { server.off('listening', onListening); reject(error); };
  const onListening = () => { server.off('error', onError); resolve(); };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
});

const close = (server, sockets = new Set()) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = error => {
    if (settled) return;
    settled = true;
    clearTimeout(force);
    error ? reject(error) : resolve();
  };
  const force = setTimeout(() => {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections?.();
  }, 250);
  force.unref();
  server.close(finish);
});

export async function createRecoveryProxy({ frontPort, backendPort, controlPort, secret }) {
  let listening = false;
  const frontSockets = new Set();
  const front = http.createServer((request, response) => {
    const upstream = http.request({
      hostname: '127.0.0.1',
      port: backendPort,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${backendPort}` },
    }, result => {
      response.writeHead(result.statusCode ?? 502, result.headers);
      result.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end('isolated recovery proxy unavailable');
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  front.on('connection', socket => {
    frontSockets.add(socket);
    socket.once('close', () => frontSockets.delete(socket));
  });
  const pause = async () => {
    if (!listening) return;
    listening = false;
    await close(front, frontSockets);
  };
  const resume = async () => {
    if (listening) return;
    await listen(front, frontPort);
    listening = true;
  };
  const control = http.createServer(async (request, response) => {
    if (request.headers['x-hps-recovery-secret'] !== secret) { response.writeHead(401).end(); return; }
    try {
      if (request.method === 'POST' && request.url === '/pause') await pause();
      else if (request.method === 'POST' && request.url === '/resume') await resume();
      else if (!(request.method === 'GET' && request.url === '/state')) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ listening }));
    } catch {
      response.writeHead(500).end();
    }
  });
  await resume();
  try {
    await listen(control, controlPort);
  } catch (error) {
    await pause().catch(() => {});
    throw error;
  }
  return {
    async close() {
      if (listening) await pause();
      if (control.listening) await close(control);
    },
  };
}
