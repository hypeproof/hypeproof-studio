// Credential-bearing operator read, separate from the metadata-only live board.
// Lab delegates cohort/profile authorization to Service before reading its store.
import { Hono } from 'hono';
import type { ChalkEnv } from '../env.ts';

export const labTokens = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();
labTokens.get('/cohorts/:id/lab-tokens', async c => {
  c.header('cache-control', 'no-store');
  const auth = c.req.header('authorization')?.trim() ?? '';
  if (!/^Bearer\s+\S+$/i.test(auth)) return c.json({ error: '강사 토큰이 필요합니다.' }, 401);
  const cohort = c.req.param('id');
  if (!/^[a-z0-9-]{1,64}$/i.test(cohort)) return c.json({ error: '수업 구분자를 확인해주세요.' }, 400);
  // Controlled acceptance reads only an owned dedicated synthetic seat. The
  // existing issuer/key authority stays in Service through Lab; no local board.
  const ownerKey = c.req.header('x-hps-release-seat-key');
  if (/^release-test-/i.test(cohort) || ownerKey !== undefined) {
    const profile = c.req.query('profile') ?? '';
    if (!/^release-test-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(cohort) ||
      !['synthetic-release-acceptance', 'canary-sdk-contract'].includes(profile) || new URL(c.req.url).searchParams.getAll('profile').length !== 1)
      return c.json({ error: '명시한 검증 수업·트랙을 확인해주세요.' }, 400);
    if (!/^[a-f0-9]{64}$/.test(ownerKey ?? '') || auth.length > 16384)
      return c.json({ error: '검증 좌석의 조회 소유권 키가 필요합니다.' }, 401);
    try {
      const upstream = await fetch(`https://hypeproof-ai.xyz/api/workshop/boa-room/instructor?cohort=${encodeURIComponent(cohort)}&profile=${encodeURIComponent(profile)}`, {
        method: 'GET', headers: { authorization: auth, 'x-hps-release-seat-key': ownerKey! }, redirect: 'error', signal: AbortSignal.timeout(8_000),
      });
      if (!upstream.ok) return c.json({ error: '검증 좌석의 조회 권한·유효기간을 확인하지 못했습니다.' },
        ([401, 403, 404, 409, 410, 503].includes(upstream.status) ? upstream.status : 502) as 401);
      if (!upstream.body) throw new Error('missing body');
      const reader = upstream.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 65536) throw new Error('oversized body'); chunks.push(part.value); } } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
      const id = cohort.slice('release-test-'.length);
      if (body?.schema !== 'hps-release-board-input/1' || body.seatId !== id || body.board?.code !== id || body.board.cohort !== cohort || body.board.profile !== profile ||
        body.comparison !== 'NOT_OBSERVED' || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now() ||
        !Array.isArray(body.board.students) || body.board.students.length !== 1 || body.board.students[0]?.handle !== 'synthetic-' + id || body.board.students[0].claimedBy !== 'synthetic-' + id)
        throw new Error('synthetic scope mismatch');
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': c.get('requestId') ?? 'unknown' } });
    } catch { return c.json({ error: '검증 좌석 토큰을 불러오지 못했습니다.' }, 502); }
  }
  // Production credentials can only go to the fixed Lab origin. Overrides are local-only.
  const origin = c.env.ENVIRONMENT === 'dev' && c.env.HPS_LAB_ORIGIN?.trim()
    ? c.env.HPS_LAB_ORIGIN.trim().replace(/\/+$/, '') : 'https://hypeproof-ai.xyz';
  try {
    const upstream = await fetch(`${origin}/api/workshop/boa-room/instructor?cohort=${encodeURIComponent(cohort)}`, {
      headers: { authorization: auth }, redirect: 'manual', signal: AbortSignal.timeout(8_000),
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
