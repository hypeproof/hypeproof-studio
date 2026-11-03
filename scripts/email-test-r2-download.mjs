import { emailTestDownloadStatus } from './email-test-participant-auth.mjs';

/** Private pilot only: credentials stay in headers, artifacts are pinned by content.
 * The installer must still hash the complete download before extraction.
 * R2 bodies are forwarded as streams, never buffered or reassembled in the Worker.
 */
export function createEmailTestR2Download(config, authorize = emailTestDownloadStatus, now = Date.now) {
  const { build, expiresAt } = config;
  const candidateArtifacts = config.artifacts;
  if (!/^[a-f0-9]{8}$/.test(build) || !Number.isSafeInteger(expiresAt) || expiresAt <= 0
      || !Array.isArray(candidateArtifacts) || candidateArtifacts.length !== 2
      || candidateArtifacts.some(a => !a || typeof a !== 'object' || Array.isArray(a)
        || !['app.zip', 'sdk.zip'].includes(a.name)
        || a.path !== `/install/files/${a.name}` || !/^[a-f0-9]{64}$/.test(a.sha256)
        || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || a.bytes > 512 * 1024 * 1024)
      || new Set(candidateArtifacts.map(a => a.name)).size !== 2) {
    throw new Error('Invalid private installer pins');
  }
  // Project only public scalar fields; operator metadata must never enter responses.
  const artifacts = candidateArtifacts.map(({ name, path, sha256, bytes }) => ({ name, path, sha256, bytes }));
  const prefix = `install/${build}`;
  const publicManifest = { schema: 1, build, artifacts };
  const headers = (type = 'text/plain; charset=utf-8') => new Headers({
    'Content-Type': type, 'Cache-Control': 'private, no-store', Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  const pinnedManifest = value => value?.schema === 1 && value.build === build && value.expiresAt === expiresAt
    && Array.isArray(value.artifacts) && value.artifacts.length === artifacts.length
    && value.artifacts.every((a, i) => ['name', 'path', 'sha256', 'bytes'].every(key => a?.[key] === artifacts[i][key]));
  return async function handle(request, env) {
    const path = new URL(request.url).pathname;
    const artifact = artifacts.find(a => a.path === path);
    if (path !== '/install/manifest.json' && !artifact) return null;
    const head = request.method === 'HEAD';
    const reply = (status, body, h = headers()) => new Response(head ? null : body, { status, headers: h });
    if (!['GET', 'HEAD'].includes(request.method)) {
      const h = headers(); h.set('Allow', 'GET, HEAD'); return reply(405, 'Method not allowed', h);
    }
    try {
      // Includes the existing allowlist, pinned Service health and current access grant.
      const status = await authorize(request, env);
      if (status !== 200) return reply(status === 401 ? 401 : 503, status === 401 ? 'Unauthorized' : 'Test access unavailable');
      if (now() >= expiresAt) return reply(410, 'This test download has expired');
      if (request.headers.has('range')) return reply(416, 'Partial downloads are not supported');
      const bucket = env.HPS_INSTALL_BUCKET;
      if (!bucket?.get || !bucket?.head) return reply(503, 'Download unavailable');
      // The operator uploads and verifies both immutable objects before this marker.
      const marker = await bucket.get(`${prefix}/manifest.json`);
      if (!marker || marker.size < 1 || marker.size > 8192) {
        await marker?.body?.cancel(); return reply(410, 'Download unavailable');
      }
      let manifest;
      try { manifest = JSON.parse(await marker.text()); } catch { return reply(410, 'Download unavailable'); }
      if (!pinnedManifest(manifest)) return reply(410, 'Download unavailable');
      if (!artifact) return reply(200, JSON.stringify(publicManifest), headers('application/json; charset=utf-8'));
      const key = `${prefix}/${artifact.sha256}/${artifact.name}`;
      const object = head ? await bucket.head(key) : await bucket.get(key);
      const checksum = object?.checksums?.sha256;
      const digest = checksum && Array.from(new Uint8Array(checksum), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!object || object.size !== artifact.bytes || (digest && digest !== artifact.sha256) || (!head && !object.body)) {
        await object?.body?.cancel(); return reply(503, 'Download unavailable');
      }
      const h = headers('application/zip');
      h.set('Content-Length', String(artifact.bytes));
      h.set('X-Content-SHA256', artifact.sha256);
      h.set('Content-Disposition', `attachment; filename="${artifact.name}"`);
      h.set('Accept-Ranges', 'none');
      return new Response(head ? null : object.body, { status: 200, headers: h });
    } catch { return reply(503, 'Download unavailable'); }
  };
}
