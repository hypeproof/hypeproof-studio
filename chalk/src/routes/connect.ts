// Lab login connection (see src/lib/connect.ts for the session itself).
//
//   GET  /connect/start?next=/console  — state cookie, then 302 to the Lab connect page
//   GET  /connect/callback?code&state  — check state, trade the code server-to-server, set the session
//   GET  /connect/status               — { connected, member, instructor_id, expires_at, scopes } (never the issuer token)
//   POST /connect/disconnect           — clear the session
import { Hono } from "hono";
import { resolveLabOrigin, type ChalkEnv } from "../env.ts";
import {
  CONNECT_PAGES, CONNECT_SECRET_HEADER, STATE_COOKIE, clearSessionCookies, clearStateCookie, connectSecret,
  issuerClaims, randomId, readConnection, readCookies, sameOriginWrite, sameString, sealConnection,
  sessionCookies, stateCookie,
} from "../lib/connect.ts";

export const connect = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();

const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const pageFor = (raw: string | undefined) =>
  (CONNECT_PAGES as readonly string[]).includes(raw ?? "") ? (raw as string) : "/console";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A small Korean page for connect failures. It never echoes a code, a state or a token. */
function notice(status: number, message: string, next: string, headers: Headers = new Headers()): Response {
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  const retry = `/connect/start?next=${encodeURIComponent(next)}`;
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Lab 연결 · HypeProof Chalk</title><main style="max-width:36rem;margin:3rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif">` +
    `<h1 style="font-size:1.4rem">Lab 연결</h1><p role="alert">${escapeHtml(message)}</p>` +
    `<p><a href="${retry}">다시 연결</a> · <a href="${escapeHtml(next)}">강사 화면으로 돌아가기</a></p></main></html>`,
    { status, headers },
  );
}

connect.get("/connect/start", (c) => {
  const next = pageFor(c.req.query("next"));
  if (!connectSecret(c.env)) {
    return notice(503, "Lab 연결이 아직 설정되지 않았습니다. 운영진에게 알려주세요.", next);
  }
  const state = randomId(32);
  const callback = `${new URL(c.req.url).origin}/connect/callback`;
  const target = `${resolveLabOrigin(c.env)}/members/chalk/connect?${new URLSearchParams({ state, return: callback })}`;
  const headers = new Headers({ location: target, "cache-control": "no-store" });
  headers.append("set-cookie", stateCookie(`${state}.${next.slice(1)}`));
  return new Response(null, { status: 302, headers });
});

connect.get("/connect/callback", async (c) => {
  const rid = c.get("requestId") ?? "no-request-id";
  const [held, page] = (readCookies(c.req.header("cookie")).get(STATE_COOKIE) ?? "").split(".");
  const next = pageFor(page ? `/${page}` : undefined);
  const headers = new Headers();
  headers.append("set-cookie", clearStateCookie()); // one use, whatever happens next
  const secret = connectSecret(c.env);
  if (!secret) return notice(503, "Lab 연결이 아직 설정되지 않았습니다. 운영진에게 알려주세요.", next, headers);

  const state = c.req.query("state") ?? "";
  const code = c.req.query("code") ?? "";
  if (!held || !STATE_RE.test(state) || !(await sameString(held, state))) {
    return notice(400, "연결 요청이 이 브라우저에서 시작한 것과 맞지 않습니다. 다시 연결해주세요.", next, headers);
  }
  if (!CODE_RE.test(code)) return notice(400, "Lab에서 받은 연결 코드가 올바르지 않습니다. 다시 연결해주세요.", next, headers);

  let answer: Response;
  try {
    // workerd rejects redirect: "error", so take "manual" and refuse any 3xx.
    answer = await fetch(`${resolveLabOrigin(c.env)}/api/chalk/connect/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", [CONNECT_SECRET_HEADER]: secret, "x-request-id": rid },
      body: JSON.stringify({ code, state }),
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    console.error(`[${rid}] connect exchange failed:`, err instanceof Error ? err.name : "upstream error");
    return notice(502, "Lab에 연결하지 못했습니다. 잠시 후 다시 연결해주세요.", next, headers);
  }
  const body = (await answer.json().catch(() => null)) as
    | { issuer?: unknown; expires_at?: unknown; member?: { name?: unknown; handle?: unknown } }
    | null;
  if (!answer.ok || !body || typeof body.issuer !== "string" || !TOKEN_SHAPE.test(body.issuer)) {
    // Status only: the Lab body names no secret, but nothing from it is worth logging.
    console.error(`[${rid}] connect exchange refused: status=${answer.status}`);
    return notice(answer.status === 400 ? 400 : 502, "Lab에서 연결을 확인하지 못했습니다. 연결 코드는 한 번, 1분 안에만 쓸 수 있습니다. 다시 연결해주세요.", next, headers);
  }
  const claimed = issuerClaims(body.issuer)?.exp ?? 0;
  const said = typeof body.expires_at === "string" ? Math.floor(Date.parse(body.expires_at) / 1000) : 0;
  const exp = [claimed, said].filter((v) => Number.isFinite(v) && v > 0).reduce((a, b) => Math.min(a, b), Infinity);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(exp) || exp <= now) return notice(502, "Lab이 보낸 강사 권한이 이미 만료됐습니다. 다시 연결해주세요.", next, headers);

  const sealed = await sealConnection(secret, {
    token: body.issuer,
    name: typeof body.member?.name === "string" ? body.member.name.slice(0, 80) : "",
    handle: typeof body.member?.handle === "string" ? body.member.handle.slice(0, 80) : "",
    exp,
  });
  for (const v of sessionCookies(sealed, exp - now)) headers.append("set-cookie", v);
  headers.set("location", next);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers });
});

connect.get("/connect/status", async (c) => {
  c.header("cache-control", "no-store");
  const configured = !!connectSecret(c.env);
  const { connection, expired } = await readConnection(c);
  if (!connection) return c.json({ connected: false, configured, ...(expired ? { expired: true } : {}) });
  const claims = issuerClaims(connection.token);
  return c.json({
    connected: true,
    configured,
    member: { name: connection.name, handle: connection.handle || claims?.u || "" },
    // The issuer id the Service matches run assignments against (E5 #3775), so an instructor refused by a run can tell
    // its owner which id to add. An id, never the token.
    instructor_id: typeof claims?.u === "string" ? claims.u : "",
    expires_at: new Date(connection.exp * 1000).toISOString(),
    scopes: claims?.scopes ?? [],
  });
});

connect.post("/connect/disconnect", (c) => {
  if (!sameOriginWrite(c)) return c.json({ error: { type: "auth", reason: "cross_origin", message: "다른 사이트에서 보낸 요청은 받지 않습니다." } }, 403);
  const headers = new Headers({ "cache-control": "no-store" });
  for (const v of clearSessionCookies()) headers.append("set-cookie", v);
  return new Response(null, { status: 204, headers });
});
