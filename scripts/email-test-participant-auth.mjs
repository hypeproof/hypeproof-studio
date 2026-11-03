// Private pilot gateway restriction, not a replacement for Service authentication.
// Participant API requests still pass Service signature, roster and grant checks.
// Downloads additionally recheck the token with the pinned Service access route.
export async function isEmailTestParticipant(request, env) {
  let tokens;
  if (env.HPS_EMAIL_TEST_PARTICIPANTS !== undefined) {
    try { tokens = JSON.parse(env.HPS_EMAIL_TEST_PARTICIPANTS); } catch { return false; }
  } else {
    tokens = env.HPS_EMAIL_TEST_PARTICIPANT ? [env.HPS_EMAIL_TEST_PARTICIPANT] : [];
  }
  if (!Array.isArray(tokens) || tokens.length < 1 || tokens.length > 3 ||
      tokens.some(token => typeof token !== 'string' || !token || token.length > 8192 || /\s/.test(token)) ||
      new Set(tokens).size !== tokens.length) return false;
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice(7);
  if (!supplied || supplied.length > 8192 || /\s/.test(supplied)) return false;
  const encoder = new TextEncoder();
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  const [actual, ...expected] = await Promise.all([supplied, ...tokens].map(digest));
  let accepted = 0;
  for (const candidate of expected) {
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ candidate[i];
    accepted |= Number(difference === 0);
  }
  return accepted === 1;
}

export async function emailTestDownloadStatus(request, env) {
  if (!(await isEmailTestParticipant(request, env))) return 401;
  if (!/^[a-f0-9-]{36}$/.test(env.HPS_EMAIL_VERSION ?? '') ||
      !env.HPS_EMAIL_EXPECTED_BUILD || typeof env.EXISTING_AI?.fetch !== 'function') return 503;
  try {
    const response = await env.EXISTING_AI.fetch('https://api.hypeproof-ai.xyz/v1/access', {
      headers: {
        authorization: request.headers.get('authorization'),
        'Cloudflare-Workers-Version-Overrides': 'hypeproof-studio-api="' + env.HPS_EMAIL_VERSION + '"',
      },
      redirect: 'manual',
    });
    const versionMatches = response.headers.get('x-hps-email-test') === env.HPS_EMAIL_EXPECTED_BUILD;
    await response.body?.cancel();
    if (!versionMatches) return 503;
    if (response.status === 401 || response.status === 403) return 401;
    return response.status === 200 ? 200 : 503;
  } catch { return 503; }
}
