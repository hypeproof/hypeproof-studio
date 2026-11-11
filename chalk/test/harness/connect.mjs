// Test-only: a Lab-connected instructor session without running the Lab.
//
// Production Chalk takes the instructor issuer only from its sealed httpOnly
// session (src/lib/connect.ts) and refuses a request that brings its own
// Authorization header. Tests that describe "instructor X calls route Y" seal X
// into that same session cookie here, so they exercise the real unseal-and-forward
// path. Nothing in src/ reads these helpers.
import { sealConnection, sessionCookies } from "../../src/lib/connect.ts";

export const TEST_CONNECT_SECRET = "synthetic-chalk-connect-secret-0123456789abcdef";

const STUDENT_PATH = /^\/v1\/(?:classroom\/shares(?:\/.*)?|profile)$/;

function claimsOf(token) {
  try { return JSON.parse(Buffer.from(String(token).split(".")[0], "base64url").toString("utf8")); } catch { return {}; }
}

/**
 * The Cookie header value for a connected session holding `token`. The session
 * lasts an hour unless `exp` says otherwise, independent of the token's own claims,
 * so a fixture token that is expired or forged still reaches the Service and the
 * Service's verdict is what the test sees.
 */
export async function sessionCookie(token, { name = "합성 강사", handle, exp, secret = TEST_CONNECT_SECRET } = {}) {
  const claims = claimsOf(token);
  const until = exp ?? Math.floor(Date.now() / 1000) + 3600;
  const sealed = await sealConnection(secret, { token, name, handle: handle ?? claims.u ?? "", exp: until });
  return sessionCookies(sealed, Math.max(60, until - Math.floor(Date.now() / 1000)))
    .filter((v) => !/Max-Age=0/.test(v))
    .map((v) => v.split(";")[0])
    .join("; ");
}

async function connectedRequest(request, issuer) {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("cookie", [headers.get("cookie"), await sessionCookie(issuer)].filter(Boolean).join("; "));
  // A Chalk page's own fetch: same origin.
  if (!/^(GET|HEAD)$/i.test(request.method) && !headers.has("origin")) headers.set("origin", new URL(request.url).origin);
  const body = /^(GET|HEAD)$/i.test(request.method) ? undefined : await request.arrayBuffer();
  return new Request(request.url, { method: request.method, headers, body, redirect: request.redirect });
}

/**
 * Wraps a Chalk app (or a wrapper of one) for tests written as "Bearer X calls Y":
 * an instructor request's `Authorization: Bearer X` becomes the connected session
 * holding X, and the env gains the connect secret. Student share/profile routes
 * keep their Bearer. A header with no usable token (Basic, bare "Bearer") is left
 * as is, so Chalk's refusal of client-sent credentials is still what answers.
 */
export function withBearerAsConnection(app, secret = TEST_CONNECT_SECRET) {
  return {
    async fetch(request, env = {}, ctx) {
      const m = /^Bearer\s+(\S+)$/i.exec((request.headers.get("authorization") ?? "").trim());
      const path = new URL(request.url).pathname;
      const next = m && !STUDENT_PATH.test(path) ? await connectedRequest(request, m[1]) : request;
      return app.fetch(next, { ...env, HPS_CHALK_CONNECT_SECRET: env.HPS_CHALK_CONNECT_SECRET ?? secret }, ctx);
    },
  };
}

/**
 * For browser tests: the page sends `x-test-chalk-issuer` (Playwright
 * setExtraHTTPHeaders, see signInChalk) and this turns it into the connected
 * session before Chalk sees the request. The header never reaches Chalk. The e2e
 * loopback bridges rebuild requests on a fixed `http://localhost` base, so the URL
 * gets its real host back from the Host header; Chalk's same-origin write check
 * then compares the page's Origin with the address the browser actually used.
 */
export function withHeaderConnection(app, secret = TEST_CONNECT_SECRET) {
  return {
    async fetch(request, env = {}, ctx) {
      const issuer = request.headers.get("x-test-chalk-issuer");
      let next = request;
      if (issuer !== null) {
        const headers = new Headers(request.headers);
        headers.delete("x-test-chalk-issuer");
        if (issuer) headers.set("cookie", [headers.get("cookie"), await sessionCookie(issuer)].filter(Boolean).join("; "));
        const url = new URL(request.url);
        const host = headers.get("host");
        const target = host ? `${url.protocol}//${host}${url.pathname}${url.search}` : request.url;
        const body = /^(GET|HEAD)$/i.test(request.method) ? undefined : await request.arrayBuffer();
        next = new Request(target, { method: request.method, headers, body, redirect: request.redirect });
      }
      return app.fetch(next, { ...env, HPS_CHALK_CONNECT_SECRET: env.HPS_CHALK_CONNECT_SECRET ?? secret }, ctx);
    },
  };
}

/**
 * Playwright: the page becomes a Lab-connected instructor holding `issuer`, as if it
 * had come back from the Lab connect page. A falsy issuer signs the page out.
 * Requires the Chalk app behind the page to be wrapped with withHeaderConnection.
 */
export async function signInChalk(page, issuer) {
  await page.setExtraHTTPHeaders(issuer ? { "x-test-chalk-issuer": String(issuer) } : {});
  await page.evaluate(() => globalThis.chalkConnection?.refresh());
}
