// studio-funnel-events — App funnel events go to the Service's grant-scoped POST /v1/trial/events
// as `{type, fields}`, only after a GET probe of that route answers, never to the session-only
// /v1/trace/event, and carry only fields the Service parser accepts.
//
// Contract cross-check: test/fixtures/service-contracts/trial-funnel.json was captured by running
// the Service's own parseAppEvent (hypeproof-service worker/src/lib/trial-funnel.ts) over every
// body the Studio builder can produce plus revision-1 shapes it must refuse. This test
//   1. checks a fixture-driven replica of that parser against every recorded verdict, and
//   2. feeds every body Studio produces through the replica and compares them byte for byte
//      with the captured accepted samples.
// With HPS_SERVICE_WORKER_DIR=<hypeproof-service>/worker it also imports the real Service parser
// and runs the same bodies through it (local cross-check; the App CI has no Service checkout).
//
// Run: node --experimental-strip-types test/funnel-events.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  APP_VERSION_RE,
  ENTRY_OUTCOMES,
  FUNNEL_EVENT_FIELDS,
  FUNNEL_OS,
  FunnelReporter,
  OFFER_SURFACES,
  PASS_SURFACES,
  PURCHASE_PATH_EVENTS,
  TOOL_RESULT_KINDS,
  TRACE_EVENT_ROUTE,
  TRIAL_EVENTS_ROUTE,
  TRIAL_FUNNEL_SCHEMA,
  buildFunnelEvent,
  entryOutcome,
  funnelOs,
  funnelProfileStep,
  funnelToolKind,
  isTrialGrantToken,
  parseTrialEventsProbe,
  passSurface,
  trialEventsUrl,
  usesTraceRoute,
} from "../src/funnelEvents.ts";

const CONTRACT = JSON.parse(readFileSync(new URL("./fixtures/service-contracts/trial-funnel.json", import.meta.url), "utf8"));
const PROXY = "https://api.hypeproof-ai.xyz/v1";
const URL_ON = "https://api.hypeproof-ai.xyz/v1/trial/events";
const ALL_EVENTS = CONTRACT.probe.body.events;
const flush = () => new Promise((r) => setImmediate(r));

/** Replica of the Service parseAppEvent, driven only by the captured spec. */
function serviceAccepts(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (Object.keys(body).some((k) => !CONTRACT.route.top_level_keys.includes(k))) return false;
  const spec = CONTRACT.app_events[body.type];
  if (!spec) return false;
  const f = body.fields ?? {};
  if (!f || typeof f !== "object" || Array.isArray(f)) return false;
  if (Object.keys(f).some((k) => !Object.hasOwn(spec, k))) return false;
  const re = new RegExp(CONTRACT.version_re);
  for (const [name, fs] of Object.entries(spec)) {
    const v = f[name];
    if (v === undefined) { if (fs.required) return false; continue; }
    const ok = fs.kind === "enum" ? fs.values.includes(v) : fs.kind === "bool" ? typeof v === "boolean" : typeof v === "string" && re.test(v);
    if (!ok) return false;
  }
  return JSON.stringify(body).length <= CONTRACT.route.body_max_bytes;
}

/** Every input the Studio builder accepts, one per enum combination. */
function studioInputs() {
  const out = [];
  for (const outcome of ENTRY_OUTCOMES) {
    out.push({ type: "trial_entry", outcome });
    for (const os of FUNNEL_OS) out.push({ type: "trial_entry", outcome, app_version: "0.1.60", os });
    out.push({ type: "trial_entry", outcome, app_version: "0.1.61-rc.2" });
    out.push({ type: "trial_entry", outcome, app_version: "2026.1019.0" }); // shipped calendar version (D1)
  }
  for (const kind of TOOL_RESULT_KINDS) for (const ok of [true, false]) out.push({ type: "trial_tool_result", kind, ok });
  for (const t of ["offer_viewed", "offer_clicked", "offer_dismissed"]) for (const surface of OFFER_SURFACES) out.push({ type: t, surface });
  for (const t of PURCHASE_PATH_EVENTS) for (const surface of PASS_SURFACES) out.push({ type: t, surface });
  return out;
}

function recorder(status = 200) {
  const calls = [];
  const reporter = new FunnelReporter({
    send: async (url, token, body) => {
      calls.push({ url, token, body: JSON.parse(JSON.stringify(body)) });
      return status;
    },
  });
  return { reporter, calls };
}

// ─── Contract fixture: replica agrees with every real parser verdict ─────────────────────
{
  assert.equal(CONTRACT.route.path, TRIAL_EVENTS_ROUTE, "Studio route = Service route");
  assert.equal(CONTRACT.probe.body.schema, TRIAL_FUNNEL_SCHEMA);
  assert.deepEqual(CONTRACT.route.top_level_keys, ["type", "fields"]);
  const accepted = CONTRACT.samples.filter((s) => s.accepted);
  const refused = CONTRACT.samples.filter((s) => !s.accepted);
  assert.ok(accepted.length > 0 && refused.length > 0, "fixture has positive and negative controls");
  for (const s of CONTRACT.samples) assert.equal(serviceAccepts(s.body), s.accepted, `replica disagrees with Service on ${JSON.stringify(s.body)}`);
  // The revision-1 Studio shapes are among the refused samples (regression lock).
  const msgs = refused.map((s) => s.message);
  assert.ok(msgs.includes("unknown key: event"), "{event, ...} body is refused by the Service");
  assert.ok(msgs.includes("unknown field: guardian"), "offer guardian is refused by the Service");
  assert.ok(refused.some((s) => s.body.type === "trial_age_answered"), "age event is not a Service event");
}

// ─── Studio vocabulary = Service vocabulary ──────────────────────────────────────────────
{
  assert.deepEqual(Object.keys(FUNNEL_EVENT_FIELDS).sort(), Object.keys(CONTRACT.app_events).sort(), "same event types");
  for (const [t, spec] of Object.entries(CONTRACT.app_events)) assert.deepEqual([...FUNNEL_EVENT_FIELDS[t]].sort(), Object.keys(spec).sort(), `${t} fields`);
  assert.deepEqual([...ENTRY_OUTCOMES], CONTRACT.app_events.trial_entry.outcome.values);
  assert.deepEqual([...FUNNEL_OS], CONTRACT.app_events.trial_entry.os.values);
  assert.deepEqual([...TOOL_RESULT_KINDS], CONTRACT.app_events.trial_tool_result.kind.values);
  assert.deepEqual([...OFFER_SURFACES], CONTRACT.app_events.offer_viewed.surface.values);
  // CONV-FUNNEL-R-006 — the purchase-path events (Service #168): one required `surface` each.
  for (const t of PURCHASE_PATH_EVENTS) {
    assert.ok(ALL_EVENTS.includes(t), `the Service probe lists ${t}`);
    assert.deepEqual([...PASS_SURFACES], CONTRACT.app_events[t].surface.values, `${t} surfaces`);
    assert.equal(CONTRACT.app_events[t].surface.required, true);
  }
  assert.equal(APP_VERSION_RE.source, CONTRACT.version_re);
}

// ─── Every Studio body is accepted, and equals the captured accepted sample ──────────────
const studioBodies = studioInputs().map((i) => buildFunnelEvent(i));
{
  const captured = CONTRACT.samples.filter((s) => s.accepted).map((s) => JSON.stringify(s.body));
  for (const b of studioBodies) {
    assert.ok(b, "builder accepts every enum combination");
    assert.ok(serviceAccepts(b), `Service parser shape refuses ${JSON.stringify(b)}`);
    assert.ok(captured.includes(JSON.stringify(b)), `body not in the captured Service-accepted samples: ${JSON.stringify(b)}`);
  }
  assert.equal(studioBodies.length, captured.length, "fixture covers exactly the Studio body matrix");
}

// ─── Optional: the real Service parser (local cross-check) ───────────────────────────────
if (process.env.HPS_SERVICE_WORKER_DIR) {
  const dir = process.env.HPS_SERVICE_WORKER_DIR.replace(/\/+$/, "");
  await import(pathToFileURL(`${dir}/test/harness/loader.mjs`).href);
  const svc = await import(pathToFileURL(`${dir}/src/lib/trial-funnel.ts`).href);
  assert.equal(svc.TRIAL_FUNNEL_SCHEMA, TRIAL_FUNNEL_SCHEMA);
  assert.deepEqual(Object.keys(svc.APP_EVENTS), ALL_EVENTS);
  for (const b of studioBodies) {
    const r = svc.parseAppEvent(JSON.parse(JSON.stringify(b)));
    assert.ok(r.ok, `real Service parser refuses ${JSON.stringify(b)}: ${r.message}`);
    assert.deepEqual(r.event, b, "the Service records exactly what Studio sent");
  }
  for (const s of CONTRACT.samples) assert.equal(svc.parseAppEvent(s.body).ok, s.accepted, `fixture stale for ${JSON.stringify(s.body)}`);
  for (const [t, spec] of Object.entries(svc.APP_EVENTS)) assert.deepEqual(CONTRACT.app_events[t], spec.fields, `fixture app_events stale for ${t}`);
  // Provenance pins the exact Service sources the fixture was captured from; a moved
  // Service head must be followed by a regenerated fixture, not a silently stale pin.
  const { createHash } = await import("node:crypto");
  const repo = dir.replace(/\/worker$/, "");
  for (const [rel, sha] of Object.entries(CONTRACT.provenance.sources)) {
    const actual = createHash("sha256").update(readFileSync(`${repo}/${rel}`)).digest("hex");
    assert.equal(actual, sha, `fixture provenance stale for ${rel}: regenerate from the Service head`);
  }
  console.log("funnel-events smoke: real Service parser cross-check ok");
}

// ─── Builder: allowed fields only, ids and free text dropped ─────────────────────────────
{
  const leaky = buildFunnelEvent({
    type: "trial_tool_result", kind: "edit", ok: false,
    grant_id: "g_123", account_id: "acc_1", email: "a@b.c", install_id: "i", ip: "1.2.3.4",
    file_path: "/Users/kid/index.html", text: "내 비밀 메시지", token: "eyJ...", fields: { x: 1 },
  });
  assert.deepEqual(leaky, { type: "trial_tool_result", fields: { kind: "edit", ok: false } });
  assert.ok(serviceAccepts(leaky));
  for (const [name, fields] of Object.entries(FUNNEL_EVENT_FIELDS)) {
    for (const f of fields) assert.ok(!/id$|email|token|text|path|ip$|name$/.test(f), `${name}.${f} must not be an identifier or free text`);
  }
  // Optional entry fields with a value the Service would refuse are dropped, not sent.
  assert.deepEqual(buildFunnelEvent({ type: "trial_entry", outcome: "granted", app_version: "dev-build", os: "freebsd" }),
    { type: "trial_entry", fields: { outcome: "granted" } });
  // Negative: unknown types, revision-1 names and bad values are refused (null), not coerced.
  for (const bad of [
    { type: "trial_first_message" },
    { type: "heartbeat" },
    { event: "trial_entry_viewed", app_version: "0.1.60", os: "mac" },
    { type: "trial_entry_viewed" },
    { type: "trial_age_answered", age_band: "14_17" },
    { type: "account_sign_in_started" },
    { type: "trial_entry", outcome: "refused" },
    { type: "trial_entry" },
    { type: "trial_tool_result", kind: "bash", ok: true },
    { type: "trial_tool_result", kind: "write", ok: "yes" },
    { type: "offer_viewed", surface: "chat" },
    // CONV-FUNNEL-R-006 negatives: the offer events keep their own two surfaces; the purchase-path
    // events need a listed surface; near-miss names are not Service types.
    { type: "offer_viewed", surface: "header_menu" },
    { type: "pass_list_viewed" },
    { type: "pass_list_viewed", surface: "menu" },
    { type: "checkout_opened", surface: "chat" },
    { type: "sign_in_completed", surface: "" },
    { type: "pass_list_opened", surface: "end_card" },
    { type: "sign_in", surface: "end_card" },
    { type: "checkout_started", surface: "end_card" },
    null,
  ]) assert.equal(buildFunnelEvent(bad), null, JSON.stringify(bad));
}

// ─── CONV-FUNNEL-R-006: purchase-path bodies carry the surface and nothing else ─────────────
{
  const leaky = buildFunnelEvent({ type: "checkout_opened", surface: "end_card", product_id: "pass-30d", order_id: "ord_1", account_id: "acc_1", email: "a@b.c", url: "https://pay.test/?order=1" });
  assert.deepEqual(leaky, { type: "checkout_opened", fields: { surface: "end_card" } }, "product, order, account and url never leave");
  assert.ok(serviceAccepts(leaky));
  assert.equal(passSurface("header_menu"), "header_menu");
  assert.equal(passSurface("end_card"), "end_card");
  for (const bad of [undefined, null, "menu", "chat", 1, { surface: "end_card" }]) assert.equal(passSurface(bad), "start_page", String(bad));
  assert.equal(passSurface("chat", "end_card"), "end_card", "the caller's fallback");
}

// ─── Small mappers ───────────────────────────────────────────────────────────────────────
{
  assert.equal(funnelOs("darwin"), "darwin");
  assert.equal(funnelOs("win32"), "win32");
  assert.equal(funnelOs("linux"), "linux");
  assert.equal(funnelOs("freebsd"), undefined);
  assert.equal(funnelToolKind("Write"), "write");
  assert.equal(funnelToolKind("Edit"), "edit");
  assert.equal(funnelToolKind("MultiEdit"), "edit");
  assert.equal(funnelToolKind("mcp__hypeproof__live_preview_start"), "preview");
  assert.equal(funnelToolKind("mcp__hypeproof__publish_site"), "publish");
  for (const n of ["Read", "Bash", "Grep", "mcp__hypeproof__browser_read", "WebSearch", "publish_site_extra"]) assert.equal(funnelToolKind(n), null, n);

  assert.equal(isTrialGrantToken({ native_trial: true }), true);
  assert.equal(isTrialGrantToken({ native_trial: "true" }), false);
  assert.equal(isTrialGrantToken({ c: "class-a" }), false, "cohort seat → never probed (the route answers 403)");
  assert.equal(isTrialGrantToken(undefined), false);

  assert.equal(entryOutcome({ account: true, token: "t", startupToken: "t" }), "signed_in");
  assert.equal(entryOutcome({ account: false, token: "t", startupToken: "t" }), "reused", "grant stored before this launch");
  assert.equal(entryOutcome({ account: false, token: "t2", startupToken: "t" }), "granted", "grant stored during this launch");
  assert.equal(entryOutcome({ account: false, token: "t", startupToken: null }), "granted");
}

// ─── Discovery: GET /v1/trial/events; only the captured "on" answer turns it on ──────────
{
  assert.equal(trialEventsUrl(PROXY), URL_ON);
  assert.equal(trialEventsUrl(PROXY + "/"), URL_ON);
  assert.equal(trialEventsUrl("http://127.0.0.1:8787/v1"), "http://127.0.0.1:8787/v1/trial/events");
  assert.notEqual(TRIAL_EVENTS_ROUTE, TRACE_EVENT_ROUTE);
  assert.deepEqual(parseTrialEventsProbe(CONTRACT.probe.status, CONTRACT.probe.body), { events: ALL_EVENTS }, "Service on → every type");
  // Negative controls: the Service flag off (404), wrong schema, malformed, server error.
  assert.equal(parseTrialEventsProbe(CONTRACT.probe_off.status, CONTRACT.probe_off.body), null, "flag off → off");
  assert.equal(parseTrialEventsProbe(200, { schema: "hps-trial-funnel/2", events: ALL_EVENTS }), null, "unknown schema → off");
  assert.equal(parseTrialEventsProbe(200, { schema: TRIAL_FUNNEL_SCHEMA }), null);
  assert.equal(parseTrialEventsProbe(200, null), null);
  assert.equal(parseTrialEventsProbe(500, CONTRACT.probe.body), null);
  // A future Service type the App does not know is ignored; a type it no longer lists is not sent.
  assert.deepEqual(parseTrialEventsProbe(200, { schema: TRIAL_FUNNEL_SCHEMA, events: ["trial_entry", "trial_age_answered"] }), { events: ["trial_entry"] });
}

// ─── Trace route: only a trial grant with the funnel route on stops using /v1/trace/event ─
{
  assert.equal(usesTraceRoute(true, { native_trial: true }), false);
  assert.equal(usesTraceRoute(false, { native_trial: true }), true, "Service flag off → behaviour unchanged");
  assert.equal(usesTraceRoute(true, { c: "class-a" }), true, "classroom seats keep liveness");
  assert.equal(usesTraceRoute(false, undefined), true);
}

// ─── Reporter: Service body + URL captured; queue before a grant; drop when off ──────────
{
  const { reporter, calls } = recorder();
  // Before a grant exists (start-page offer) events wait in memory.
  reporter.emit({ type: "offer_viewed", surface: "start_page" });
  reporter.emit({ type: "offer_clicked", surface: "start_page" });
  await flush();
  assert.equal(calls.length, 0, "nothing is sent before the probe answers");

  reporter.setTarget({ url: URL_ON, token: "grant-token-A", events: ALL_EVENTS });
  reporter.emit({ type: "trial_entry", outcome: "granted", app_version: "0.1.60", os: "darwin" });
  await flush();
  assert.deepEqual(calls.map((c) => c.body.type), ["offer_viewed", "offer_clicked", "trial_entry"], "queued events flush in order");
  for (const c of calls) {
    assert.equal(c.url, URL_ON);
    assert.ok(!c.url.includes("/trace/event"), "never the session-only trace route");
    assert.equal(c.token, "grant-token-A");
    assert.deepEqual(Object.keys(c.body), ["type", "fields"], "exactly the Service top-level keys");
    assert.ok(serviceAccepts(c.body), `Service would refuse ${JSON.stringify(c.body)}`);
  }

  reporter.emit({ type: "trial_tool_result", kind: "write", ok: true, file_path: "/x/index.html" });
  reporter.emit({ type: "trial_tool_result", kind: "write", ok: true });
  reporter.emit({ type: "trial_entry", outcome: "reused" });
  reporter.emit({ type: "offer_viewed", surface: "start_page" });
  reporter.emit({ type: "offer_dismissed", surface: "end_card" });
  reporter.emit({ type: "offer_dismissed", surface: "end_card" });
  reporter.emit({ type: "bogus" });
  await flush();
  assert.deepEqual(calls.slice(3).map((c) => c.body), [
    { type: "trial_tool_result", fields: { kind: "write", ok: true } },
    { type: "offer_dismissed", fields: { surface: "end_card" } },
    { type: "offer_dismissed", fields: { surface: "end_card" } },
  ], "first tool result per kind/outcome, entry and offer views once per grant; dismissals every time; bogus dropped");
  for (const c of calls) assert.ok(serviceAccepts(c.body));

  // A new grant is a new trial: its entry and first tool result are reported again.
  reporter.setTarget({ url: URL_ON, token: "grant-token-B", events: ALL_EVENTS });
  reporter.emit({ type: "trial_entry", outcome: "signed_in" });
  reporter.emit({ type: "trial_tool_result", kind: "write", ok: true });
  await flush();
  assert.deepEqual(calls.slice(-2).map((c) => [c.token, c.body.type]), [["grant-token-B", "trial_entry"], ["grant-token-B", "trial_tool_result"]]);
}
{
  // Only types the Service lists are sent.
  const { reporter, calls } = recorder();
  reporter.setTarget({ url: URL_ON, token: "t", events: ["trial_entry"] });
  reporter.emit({ type: "offer_clicked", surface: "start_page" });
  reporter.emit({ type: "trial_entry", outcome: "granted" });
  await flush();
  assert.deepEqual(calls.map((c) => c.body.type), ["trial_entry"]);
}
{
  // Negative control: not a trial grant or the Service route is off → queue dropped, nothing ever sent.
  const { reporter, calls } = recorder();
  reporter.emit({ type: "offer_viewed", surface: "start_page" });
  reporter.setTarget(null);
  reporter.emit({ type: "offer_clicked", surface: "start_page" });
  reporter.emit({ type: "trial_entry", outcome: "granted" });
  await flush();
  assert.equal(calls.length, 0, "flag off → no request at all");
  reporter.setTarget({ url: URL_ON, token: "t", events: ALL_EVENTS });
  await flush();
  assert.equal(calls.length, 0, "turning it on later does not resurrect dropped events");
}
{
  // Repeated start-page views before a grant must not crowd out the click (the step this
  // fix card exists to measure). Positive control: N views + click → view once, click delivered.
  const { reporter, calls } = recorder();
  for (let i = 0; i < 40; i += 1) reporter.emit({ type: "offer_viewed", surface: "start_page" });
  reporter.emit({ type: "offer_viewed", surface: "end_card" });
  reporter.emit({ type: "offer_clicked", surface: "start_page" });
  reporter.emit({ type: "trial_tool_result", kind: "write", ok: true });
  reporter.emit({ type: "trial_tool_result", kind: "write", ok: true });
  assert.equal(reporter.queued, 4, "once-per-grant events are deduplicated in the queue");
  reporter.setTarget({ url: URL_ON, token: "t", events: ALL_EVENTS });
  await flush();
  assert.deepEqual(calls.map((c) => c.body), [
    { type: "offer_viewed", fields: { surface: "start_page" } },
    { type: "offer_viewed", fields: { surface: "end_card" } },
    { type: "offer_clicked", fields: { surface: "start_page" } },
    { type: "trial_tool_result", fields: { kind: "write", ok: true } },
  ], "views do not push the click out of the pre-grant queue");
}
{
  // The queue is bounded, and a failing send never throws into the caller.
  const reporter = new FunnelReporter({ send: async () => { throw new Error("offline"); }, maxQueue: 3 });
  for (let i = 0; i < 10; i += 1) reporter.emit({ type: "offer_clicked", surface: "start_page" });
  assert.equal(reporter.queued, 3);
  reporter.setTarget({ url: URL_ON, token: "t", events: ALL_EVENTS });
  await flush();
  assert.equal(reporter.queued, 0);
}

{
  // CONV-FUNNEL-R-006 — purchase-path events go to the grant-scoped route with the grant token the
  // reporter was given (never another credential), are sent on every emit once the route is on (the
  // Service keeps the first per grant and surface), and only when the probe lists the type.
  const { reporter, calls } = recorder();
  for (let i = 0; i < 5; i += 1) reporter.emit({ type: "pass_list_viewed", surface: "end_card" });
  reporter.emit({ type: "pass_list_viewed", surface: "header_menu" });
  assert.equal(reporter.queued, 2, "before the probe answers, one view per surface waits");
  reporter.setTarget({ url: URL_ON, token: "grant-token-F", events: ALL_EVENTS });
  reporter.emit({ type: "sign_in_started", surface: "end_card" });
  reporter.emit({ type: "sign_in_completed", surface: "end_card" });
  reporter.emit({ type: "checkout_opened", surface: "end_card" });
  reporter.emit({ type: "pass_list_viewed", surface: "end_card" });
  reporter.emit({ type: "pass_list_viewed", surface: "start_page", account_token: "account-bearer-x" });
  await flush();
  assert.deepEqual(calls.map((c) => c.body), [
    { type: "pass_list_viewed", fields: { surface: "end_card" } },
    { type: "pass_list_viewed", fields: { surface: "header_menu" } },
    { type: "sign_in_started", fields: { surface: "end_card" } },
    { type: "sign_in_completed", fields: { surface: "end_card" } },
    { type: "checkout_opened", fields: { surface: "end_card" } },
    { type: "pass_list_viewed", fields: { surface: "end_card" } },
    { type: "pass_list_viewed", fields: { surface: "start_page" } },
  ]);
  for (const c of calls) {
    assert.equal(c.token, "grant-token-F", "always the grant token the target names");
    assert.equal(c.url, URL_ON);
    assert.ok(serviceAccepts(c.body), JSON.stringify(c.body));
    assert.ok(!JSON.stringify(c.body).includes("account-bearer"), "no credential in the body");
  }
  // An older Service (before #168) lists only the first five types: the new ones are not sent.
  const old = recorder();
  old.reporter.setTarget({ url: URL_ON, token: "g", events: ["trial_entry", "trial_tool_result", "offer_viewed", "offer_clicked", "offer_dismissed"] });
  for (const t of PURCHASE_PATH_EVENTS) old.reporter.emit({ type: t, surface: "start_page" });
  old.reporter.emit({ type: "offer_clicked", surface: "start_page" });
  await flush();
  assert.deepEqual(old.calls.map((c) => c.body.type), ["offer_clicked"], "unlisted types are dropped");
  // A failing or rejecting send never throws into the caller.
  for (const send of [async () => { throw new Error("offline"); }, async () => 400, () => { throw new Error("sync"); }]) {
    const r = new FunnelReporter({ send });
    r.setTarget({ url: URL_ON, token: "g", events: ALL_EVENTS });
    for (const t of PURCHASE_PATH_EVENTS) assert.doesNotThrow(() => r.emit({ type: t, surface: "end_card" }));
    await flush(); await flush();
  }
}

{
  // Profile-read sequence: active → failed read → recovered read must keep the route on.
  // Before the fix a failed read cleared the target but kept the probe marker, so the recovered
  // read skipped the probe and the funnel stayed off (events stuck in the queue, liveness back on
  // /v1/trace/event) until restart. This replays the host's refreshFunnelTarget decisions.
  const calls = [];
  const reporter = new FunnelReporter({ send: async (url, token, body) => { calls.push({ url, token, body }); return 204; } });
  let probedToken = null;
  let probes = 0;
  const read = (profileOk, token, trialGrant = true) => {
    const step = funnelProfileStep({ profileOk, trialGrant, token, probedToken });
    if (step === "unknown") { probedToken = null; reporter.setTarget(undefined); }
    if (step === "off") { probedToken = null; reporter.setTarget(null); }
    if (step === "probe") { probedToken = token; probes += 1; reporter.setTarget({ url: URL_ON, token, events: ALL_EVENTS }); }
    return step;
  };
  assert.equal(read(true, "g1"), "probe");
  assert.ok(reporter.active && usesTraceRoute(reporter.active && probedToken === "g1", { native_trial: true }) === false);
  assert.equal(read(false, "g1"), "keep", "a failed read keeps an already-probed token's target");
  assert.ok(reporter.active, "route stays on through the failed read");
  assert.equal(usesTraceRoute(reporter.active && probedToken === "g1", { native_trial: true }), false, "no /v1/trace/event fallback");
  reporter.emit({ type: "trial_tool_result", kind: "write", ok: true });
  await flush();
  assert.equal(calls.length, 1, "events after the failed read are sent, not queued");
  assert.equal(reporter.queued, 0);
  assert.equal(read(true, "g1"), "keep", "recovered read needs no second probe");
  assert.ok(reporter.active);
  assert.equal(probes, 1);
  // A failed read for a token not probed yet is unknown and forgets the probe, so recovery probes.
  assert.equal(read(false, "g2"), "unknown");
  assert.equal(reporter.active, false);
  assert.equal(probedToken, null);
  assert.equal(read(true, "g2"), "probe", "recovered read for the new token probes again");
  assert.ok(reporter.active);
  // Not a trial grant → off.
  assert.equal(read(true, "c1", false), "off");
  assert.equal(reporter.active, false);
}

// ─── Host wiring (source locks) ──────────────────────────────────────────────────────────
{
  const host = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(host, /usesTraceRoute\(/, "liveness asks usesTraceRoute before posting to /trace/event");
  assert.match(host, /parseTrialEventsProbe\(/, "the reporter target follows the GET /v1/trial/events probe");
  assert.match(host, /isTrialGrantToken\(/, "only a native trial grant is probed");
  assert.match(host, /funnelProfileStep\(/, "profile reads go through funnelProfileStep");
  assert.ok(!/if \(!p\) \{ this\.funnel\.setTarget\(undefined\)/.test(host), "a failed read does not clear the target while keeping the probe marker");
  assert.match(host, /type: "trial_entry"/, "entry outcome is reported");
  assert.match(host, /type: "trial_tool_result"/, "SDK tool results are reported");
  assert.match(host, /funnelToolKind\(/);
  assert.ok(!/funnel_events|\/v1\/funnel\/event/.test(host), "no revision-1 profile advert or route");
  const funnelSrc = readFileSync(new URL("../src/funnelEvents.ts", import.meta.url), "utf8");
  assert.ok(!/from ["']vscode["']/.test(funnelSrc), "funnelEvents.ts stays pure (no vscode)");
  const start = readFileSync(new URL("../src/startPage.ts", import.meta.url), "utf8");
  for (const e of ["offer_viewed", "offer_clicked", "offer_dismissed"]) assert.ok(start.includes(`type: "${e}"`), `start page emits ${e}`);
  for (const e of PURCHASE_PATH_EVENTS) assert.ok(start.includes(`"${e}"`), `start page emits ${e}`);
  const ext = readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8");
  assert.match(ext, /registerCommand\("hypeproof-chat\.showPasses", \(surface\?: unknown\) => startPage\.showPurchase\(surface\)\)/, "the command forwards the surface to the start page");
  assert.match(host, /executeCommand\("hypeproof-chat\.showPasses", msg\.surface === "header_menu" \? "header_menu" : "end_card"\)/, "the chat names the surface the pass list was opened from");
  assert.ok(!/event: "/.test(start.match(/funnelEmit\?\.\([^)]*\)/g)?.join("\n") ?? ""), "no revision-1 {event} calls");
}

console.log("funnel-events smoke: ok");
