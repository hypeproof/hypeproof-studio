// Credential-bearing operator read, separate from the metadata-only live board.
// Lab delegates cohort/profile authorization to Service before reading its store.
// The Bearer is the Lab-connected issuer (src/lib/connect.ts); the Lab accepts it
// only with the shared secret, so only this server can make the call.
import { Hono } from 'hono';
import type { ChalkEnv } from '../env.ts';
import { CONNECT_SECRET_HEADER, connectSecret, instructorAuthorization } from '../lib/connect.ts';

export const labTokens = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();
labTokens.get('/cohorts/:id/lab-tokens', async c => {
  c.header('cache-control', 'no-store');
  const instructor = await instructorAuthorization(c);
  if (!instructor.ok) return c.json({ error: instructor.message, reason: instructor.reason }, instructor.status);
  const secret = connectSecret(c.env);
  if (!secret) return c.json({ error: 'Lab 연결이 설정되지 않았습니다. 운영진에게 알려주세요.' }, 503);
  const cohort = c.req.param('id');
  if (!/^[a-z0-9-]{1,64}$/i.test(cohort)) return c.json({ error: '수업 구분자를 확인해주세요.' }, 400);
  // Production credentials can only go to the fixed Lab origin. Overrides are local-only.
  const origin = c.env.ENVIRONMENT === 'dev' && c.env.HPS_LAB_ORIGIN?.trim()
    ? c.env.HPS_LAB_ORIGIN.trim().replace(/\/+$/, '') : 'https://hypeproof-ai.xyz';
  try {
    const upstream = await fetch(`${origin}/api/workshop/boa-room/instructor?cohort=${encodeURIComponent(cohort)}`, {
      headers: { authorization: instructor.authorization, [CONNECT_SECRET_HEADER]: secret },
      redirect: 'manual', signal: AbortSignal.timeout(8_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) throw new Error('redirect refused');
    return new Response(upstream.body, { status: upstream.status, headers: {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-request-id': c.get('requestId') ?? 'unknown',
    } });
  } catch {
    return c.json({ error: 'Lab 학생 토큰을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' }, 502);
  }
});
