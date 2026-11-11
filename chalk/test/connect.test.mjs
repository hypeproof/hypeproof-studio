// Lab login connection: no instructor token is pasted, put in a URL, returned to
// the browser or logged. The issuer lives only in the sealed httpOnly session and
// goes to the Service and the Lab from the server.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "@hypeproof/service-testkit/test/harness/loader.mjs";
import { TEST_CONNECT_SECRET, sessionCookie } from "./harness/connect.mjs";

const { default: app } = await import("../src/index.ts");
const { issuerClaims, openConnection } = await import("../src/lib/connect.ts");

const ORIGIN = "https://chalk.test";
const LAB = "https://hypeproof-ai.xyz";
const SERVICE = "https://service.test";
const env = { ENVIRONMENT: "production", HPS_SERVICE_ORIGIN: SERVICE, HPS_CHALK_CONNECT_SECRET: TEST_CONNECT_SECRET };
const exp = Math.floor(Date.now() / 1000) + 3600;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const issuerWith = (scopes) => `${b64u({ u: "lab-synthetic-1a2b3c", c: "", p: "", iat: exp - 86400, exp, jti: "00000000-0000-4000-8000-000000000001", role: "issuer", scopes, v: 2 })}.c3ludGhldGljLXNpZ25hdHVyZS0wMTIzNDU2Nzg5YWJjZGVm`;
const ISSUER = issuerWith([{ cohort: "synthetic-class", profiles: ["synthetic-track"], max_hours: 12, can_start_session: true, max_session_hours: 4, ops: ["observe"] }]);
const STATE = "A".repeat(10) + "b".repeat(33);
const CODE = "C".repeat(43);

const logged = [];
for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level];
  console[level] = (...args) => { logged.push(args.map(String).join(" ")); if (process.env.CHALK_TEST_VERBOSE) original(...args); };
}
test.after(() => {
  for (const line of logged) assert.ok(!line.includes(ISSUER) && !line.includes(ISSUER.split(".")[0]), "no issuer in any log line");
});

/** Replace fetch for one test; record every upstream call. */
function upstream(handler) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const req = new Request(input, init);
    const body = req.method === "GET" ? null : await req.text();
    calls.push({ url: req.url, method: req.method, headers: req.headers, body, redirect: init.redirect });
    return handler(req, body);
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

const call = (path, init = {}, e = env) => app.fetch(new Request(ORIGIN + path, init), e, {});
const cookieValues = (res) => res.headers.getSetCookie();
const connected = async (init = {}, token = ISSUER) => ({ ...init, headers: { cookie: await sessionCookie(token, { exp }), ...(init.headers ?? {}) } });

test("start sets a state cookie and sends the browser to the Lab with state and return only", async () => {
  const res = await call("/connect/start?next=/manage");
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location"));
  assert.equal(`${to.origin}${to.pathname}`, `${LAB}/members/chalk/connect`);
  assert.deepEqual([...to.searchParams.keys()].sort(), ["return", "state"]);
  assert.equal(to.searchParams.get("return"), `${ORIGIN}/connect/callback`);
  assert.match(to.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  const [state] = cookieValues(res);
  assert.match(state, /^__Host-hps_chalk_connect=[A-Za-z0-9_-]{43}\.manage; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
  assert.ok(state.includes(to.searchParams.get("state")), "the cookie binds the same state");
  // An unknown page falls back to the console.
  assert.match(cookieValues(await call("/connect/start?next=https://evil.example"))[0], /\.console;/);
  // Off without the shared secret.
  assert.equal((await call("/connect/start", {}, { ...env, HPS_CHALK_CONNECT_SECRET: "" })).status, 503);
});

test("callback refuses a state that does not match this browser, without calling the Lab", async () => {
  const lab = upstream(() => Response.json({}));
  try {
    const mismatch = await call(`/connect/callback?code=${CODE}&state=${"Z".repeat(43)}`, { headers: { cookie: `__Host-hps_chalk_connect=${STATE}.console` } });
    assert.equal(mismatch.status, 400);
    const missing = await call(`/connect/callback?code=${CODE}&state=${STATE}`);
    assert.equal(missing.status, 400);
    assert.equal(lab.calls.length, 0);
    for (const res of [mismatch, missing]) {
      assert.ok(!cookieValues(res).some((v) => v.startsWith("__Host-hps_chalk_session=") && !/Max-Age=0/.test(v)), "no session on failure");
    }
  } finally { lab.restore(); }
});

test("callback trades the code server-to-server and keeps the issuer only in the sealed httpOnly session", async () => {
  const lab = upstream(() => Response.json({ issuer: ISSUER, expires_at: new Date(exp * 1000).toISOString(), member: { name: "합성 강사", handle: "lab-synthetic-1a2b3c" } }));
  try {
    const res = await call(`/connect/callback?code=${CODE}&state=${STATE}`, { headers: { cookie: `__Host-hps_chalk_connect=${STATE}.manage` } });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/manage");
    assert.equal(await res.text(), "");
    assert.equal(lab.calls.length, 1);
    const [x] = lab.calls;
    assert.equal(x.url, `${LAB}/api/chalk/connect/exchange`, "production goes to the fixed Lab origin");
    assert.equal(x.method, "POST");
    assert.equal(x.redirect, "manual");
    assert.equal(x.headers.get("x-hps-chalk-connect-secret"), TEST_CONNECT_SECRET);
    assert.equal(x.headers.get("cookie"), null);
    assert.deepEqual(JSON.parse(x.body), { code: CODE, state: STATE });

    const set = cookieValues(res);
    assert.ok(set.some((v) => /^__Host-hps_chalk_connect=; .*Max-Age=0$/.test(v)), "state cookie is spent");
    const session = set.find((v) => v.startsWith("__Host-hps_chalk_session=") && !/Max-Age=0/.test(v));
    assert.match(session, /; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    for (const v of [res.headers.get("location"), ...set]) {
      assert.ok(!v.includes(ISSUER) && !v.includes(ISSUER.split(".")[0]) && !v.includes(ISSUER.split(".")[1]), "issuer not readable in a URL or cookie");
    }
    const sealed = session.split(";")[0].split("=")[1].replace(/^\d~/, "");
    assert.equal((await openConnection(TEST_CONNECT_SECRET, sealed))?.token, ISSUER, "the session opens to the issuer");
    assert.equal(await openConnection("another-secret-0123456789abcdef-0123", sealed), null, "and only with the secret");
  } finally { lab.restore(); }
});

test("callback reports a refused or spent code without setting a session", async () => {
  const lab = upstream(() => Response.json({ error: "code_invalid" }, { status: 400 }));
  try {
    const res = await call(`/connect/callback?code=${CODE}&state=${STATE}`, { headers: { cookie: `__Host-hps_chalk_connect=${STATE}.console` } });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /다시 연결/);
    assert.ok(!cookieValues(res).some((v) => v.startsWith("__Host-hps_chalk_session=") && !/Max-Age=0/.test(v)));
  } finally { lab.restore(); }
});

test("status names the member, expiry and scopes, never the issuer", async () => {
  const res = await call("/connect/status", await connected());
  const text = await res.text();
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(!text.includes(ISSUER) && !text.includes(ISSUER.split(".")[0]));
  const body = JSON.parse(text);
  assert.equal(body.connected, true);
  assert.equal(body.member.name, "합성 강사");
  assert.equal(body.expires_at, new Date(exp * 1000).toISOString());
  assert.deepEqual(body.scopes, issuerClaims(ISSUER).scopes);
  assert.deepEqual(await (await call("/connect/status")).json(), { connected: false, configured: true });
  const old = await sessionCookie(ISSUER, { exp: Math.floor(Date.now() / 1000) - 5 });
  assert.equal((await (await call("/connect/status", { headers: { cookie: old } })).json()).expired, true);
  const foreign = await sessionCookie(ISSUER, { secret: "another-secret-0123456789abcdef-0123" });
  assert.equal((await (await call("/connect/status", { headers: { cookie: foreign } })).json()).connected, false);
  const tampered = (await sessionCookie(ISSUER)).replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
  assert.equal((await (await call("/connect/status", { headers: { cookie: tampered } })).json()).connected, false);
});

test("a 20-scope issuer still fits the session and round-trips", async () => {
  const many = issuerWith(Array.from({ length: 20 }, (_, i) => ({ cohort: `synthetic-class-2026-${String(i).padStart(2, "0")}`, profiles: [`synthetic-track-${i}-a`, `synthetic-track-${i}-b`], max_hours: 24, can_start_session: true, max_session_hours: 12, ops: ["observe", "manage", "pause"] })));
  const cookie = await sessionCookie(many);
  assert.ok(cookie.length < 4000 * 2, `session is ${cookie.length} bytes`);
  const body = await (await call("/connect/status", { headers: { cookie } })).json();
  assert.equal(body.scopes.length, 20);
});

test("instructor calls use the connected issuer and refuse without one", async () => {
  const svc = upstream(() => Response.json({ ok: true }));
  try {
    const read = await call("/admin/cohorts/synthetic-class/state", await connected());
    assert.equal(read.status, 200);
    const write = await call("/admin/tokens/issue", await connected({ method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" }));
    assert.equal(write.status, 200);
    assert.equal(svc.calls.length, 2);
    for (const c of svc.calls) {
      assert.equal(c.headers.get("authorization"), `Bearer ${ISSUER}`);
      assert.equal(c.headers.get("cookie"), null, "the session cookie never leaves Chalk");
    }
    svc.calls.length = 0;
    const none = await call("/admin/cohorts/synthetic-class/state");
    assert.equal(none.status, 401);
    assert.equal((await none.json()).reason, "not_connected");
    const noneWrite = await call("/admin/tokens/issue", { method: "POST", headers: { origin: ORIGIN }, body: "{}" });
    assert.equal((await noneWrite.json()).error.reason, "not_connected");
    // A token the client brings is refused, even next to a valid session.
    const pasted = await call("/admin/tokens/issue", await connected({ method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${ISSUER}` }, body: "{}" }));
    assert.equal(pasted.status, 401);
    assert.equal((await pasted.json()).error.reason, "issuer_header_refused");
    assert.equal((await call("/admin/cohorts/synthetic-class/state", { headers: { authorization: `Bearer ${ISSUER}` } })).status, 401);
    // The session alone is not enough for a write from another site.
    assert.equal((await call("/admin/tokens/issue", await connected({ method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }))).status, 403);
    assert.equal((await call("/admin/tokens/issue", await connected({ method: "POST", body: "{}" }))).status, 403);
    assert.equal(svc.calls.length, 0, "no refused call reached the Service");
  } finally { svc.restore(); }
});

test("the two Lab calls carry the connected issuer and the shared secret, from the server only", async () => {
  const lab = upstream(() => Response.json({ board: null, results: [] }));
  try {
    const issue = await call("/workshop/boa-tokens", await connected({ method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ cohort: "synthetic-class", profile: "synthetic-track", users: ["s1"], hours: 1 }) }));
    assert.equal(issue.status, 200);
    const read = await call("/admin/cohorts/synthetic-class/lab-tokens", await connected());
    assert.equal(read.status, 200);
    assert.deepEqual(lab.calls.map((c) => c.url), [`${LAB}/api/workshop/boa-tokens`, `${LAB}/api/workshop/boa-room/instructor?cohort=synthetic-class`]);
    for (const c of lab.calls) {
      assert.equal(c.headers.get("authorization"), `Bearer ${ISSUER}`);
      assert.equal(c.headers.get("x-hps-chalk-connect-secret"), TEST_CONNECT_SECRET);
    }
    lab.calls.length = 0;
    assert.equal((await call("/admin/cohorts/synthetic-class/lab-tokens")).status, 401);
    assert.equal((await call("/admin/cohorts/synthetic-class/lab-tokens", { headers: { authorization: `Bearer ${ISSUER}` } })).status, 401);
    // The public routing metadata read needs no credential and carries none.
    assert.equal((await call("/workshop/boa-tokens")).status, 200);
    assert.equal(lab.calls[0].headers.get("authorization"), null);
    assert.equal(lab.calls[0].headers.get("x-hps-chalk-connect-secret"), null);
  } finally { lab.restore(); }
});

test("disconnect clears the session for a same-origin request only", async () => {
  const ok = await call("/connect/disconnect", await connected({ method: "POST", headers: { origin: ORIGIN } }));
  assert.equal(ok.status, 204);
  assert.ok(cookieValues(ok).every((v) => /Max-Age=0$/.test(v)) && cookieValues(ok).some((v) => v.startsWith("__Host-hps_chalk_session=")));
  assert.equal((await call("/connect/disconnect", { method: "POST", headers: { origin: "https://evil.example" } })).status, 403);
});

test("instructor pages have no token field and carry the Lab connect panel", async () => {
  for (const path of ["/console", "/issuer", "/board", "/authoring", "/manage", "/budgets"]) {
    const html = await (await call(path)).text();
    assert.ok(!/id="(?:issuer|token)"/.test(html), `${path} has no instructor token field`);
    assert.ok(!/hps_issuer_token|sessionStorage\.setItem\(KEY|Bearer '\s*\+|"Bearer " \+/.test(html), `${path} sends no Bearer of its own`);
    assert.ok(html.includes("data-chalk-connect") && html.includes("/connect/start?next="), `${path} offers Lab login`);
    assert.ok(!html.includes("<!--@chalk-connect-->"), `${path} marker is replaced`);
  }
  // Student pages keep their own participation code field.
  for (const path of ["/learn", "/sharing"]) assert.match(await (await call(path)).text(), /id="token"/);
  const panel = readFileSync(new URL("../src/lib/connect-panel.ts", import.meta.url), "utf8");
  assert.match(panel, /Lab 로그인으로 연결/);
  assert.match(panel, /다시 연결/);
});
