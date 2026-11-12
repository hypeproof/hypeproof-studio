// CGP-ART-R-012 (REQ-STUDIO-PUBLISH-NOTICE): the responsibility notice gates every new test link.
// Real PublishSession + PublishNoticeLedger + crBytesOwner over a synthetic Service (fetch stub) and
// an in-memory globalState. Nothing leaves the machine.
//   N1  not acknowledged: submit and link refuse with the notice reason, no preview, no checklist, no write
//   N2  an acknowledgment for another notice version is refused and not recorded
//   N3  알겠어요 with the current version: recorded once, the publish goes through
//   N4  once per learner per version: the same learner publishes again without the sheet; another
//       learner on the same machine, and the same learner after a version change, read it again
//   N5  the panel view reports the notice per signed-in learner
//   N6  fail closed: no ledger port, a token without an owner, an unsaved record, a malformed store
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { PublishSession } = await import("../src/publishSession.ts");
const { crBytesOwner } = await import("../src/crHostWiring.ts");
const notice = await import("../src/publishNotice.ts");
const { PublishNoticeLedger, PUBLISH_NOTICE_VERSION, PUBLISH_NOTICE_REQUIRED, PUBLISH_NOTICE_NOT_SAVED, PUBLISH_NOTICE_LINES } = notice;

const tok = (u) => `${Buffer.from(JSON.stringify({ u, c: "cohort-a", p: "prof", iat: 1, exp: 9e9 })).toString("base64url")}.sig`;
const root = mkdtempSync(join(tmpdir(), "publish-notice-smoke-"));
writeFileSync(join(root, "index.html"), "<!doctype html><h1>내 페이지</h1>");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`✓ ${name}`); }

// The ledger's clock moves on every read, so a second record would change the stored time.
let clock = 1_800_000_000_000;
function world({ token = tok("learner-a"), ledger, store } = {}) {
  const calls = [], previews = [], confirms = [];
  const project = { id: "prj-aaaaaaaaaaaaaaaa", title: "t", members: ["learner-a"] };
  const state = { project, test_origin: null, versions: [{ id: "v", files: [{ path: "index.html", bytes: 10, sha256: "a" }] }], hypotheses: [], experiments: [{ id: "exp-aaaaaaaaaaaaaaaa", week: 1, question: "q", method: "task_test", success_criteria: ["c"], hypothesis_id: "h", product_version_id: "v", status: "running" }], links: [] };
  const box = { value: store };
  const own = ledger === undefined ? new PublishNoticeLedger({ get: () => box.value, update: (v) => { box.value = structuredClone(v); } }, (t) => crBytesOwner(t), () => (clock += 1000)) : ledger;
  const ports = {
    ...(own ? { publishNotice: own } : {}),
    previewVisitor: async (s) => { previews.push(s); return true; },
    confirmOutbound: async (m) => { confirms.push(m); return true; },
    switchOn: () => true, scopeKey: () => "one", token: async () => w.token, base: () => "https://service.invalid/v1/curriculum",
    root: () => root, entry: () => "/index.html", events: async () => [], projectId: () => project.id, setProjectId: async () => {},
    week: () => 1, defaultTitle: () => "t", qr: (u) => u,
    fetchImpl: async (u, i) => {
      calls.push([u, i?.method ?? "GET"]);
      const path = new URL(u).pathname;
      if ((i?.method ?? "GET") === "GET") return Response.json(path.endsWith("/projects") ? { projects: [project] } : state);
      if (path.endsWith("/experiments")) return Response.json({ experiment: { id: "exp-aaaaaaaaaaaaaaaa" } });
      if (path.includes("/versions")) return Response.json({ version: { id: "v" } });
      return Response.json({ share_url: "https://test.invalid/l/AAAAAAAAAAAAAAAAAAAAAA", test_origin: "https://test.invalid" });
    },
  };
  const w = { token, calls, previews, confirms, box, ledger: own, session: new PublishSession(ports), writes: () => calls.filter(([, m]) => m !== "GET").length };
  return w;
}
const form = (extra = {}) => ({ question: "q", method: "task_test", success_criteria: ["c"], hypothesis: "h", expires_in_days: 1, ...extra });

await test("N1 not acknowledged: submit and link refuse with the notice reason before any preview, checklist or write", async () => {
  const w = world();
  assert.deepEqual(await w.session.submit(form()), { ok: false, message: PUBLISH_NOTICE_REQUIRED });
  assert.deepEqual(await w.session.link("exp-aaaaaaaaaaaaaaaa", { expires_in_days: 1 }), { ok: false, message: PUBLISH_NOTICE_REQUIRED });
  assert.equal(w.previews.length, 0, "no visitor preview");
  assert.equal(w.confirms.length, 0, "no outbound checklist");
  assert.equal(w.writes(), 0, "nothing sent");
  assert.equal(w.box.value, undefined, "nothing recorded");
});

await test("N2 an acknowledgment for another notice version is refused and not recorded", async () => {
  const w = world();
  for (const v of ["publish-notice-2026-01-01", "", 7, null]) {
    assert.deepEqual(await w.session.submit(form({ notice_version: v })), { ok: false, message: PUBLISH_NOTICE_REQUIRED }, `version ${JSON.stringify(v)}`);
  }
  assert.equal(w.ledger.acknowledged(w.token, PUBLISH_NOTICE_VERSION), false);
  assert.equal(w.writes(), 0);
});

await test("N3 알겠어요 with the current version: recorded, then the publish goes through", async () => {
  const w = world();
  const at = clock + 1000;
  const r = await w.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(w.previews.length, 1);
  assert.equal(w.confirms.length, 1);
  assert.ok(w.calls.some(([u, m]) => m === "POST" && u.endsWith("/links")), "a link was issued");
  const owner = crBytesOwner(w.token);
  assert.deepEqual(w.box.value, { v: 1, acks: { [owner]: { [PUBLISH_NOTICE_VERSION]: at } } }, "owner digest, never the identity");
  assert.doesNotMatch(JSON.stringify(w.box.value), /learner-a|cohort-a/);
});

await test("N4 once per learner per version", async () => {
  const w = world();
  assert.equal((await w.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION }))).ok, true);
  const recorded = structuredClone(w.box.value);
  // The same learner: no sheet needed, the link path too.
  assert.equal((await w.session.submit(form())).ok, true);
  assert.equal((await w.session.link("exp-aaaaaaaaaaaaaaaa", { expires_in_days: 1 })).ok, true);
  // Acknowledging again keeps the first time.
  assert.equal((await w.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION }))).ok, true);
  assert.deepEqual(w.box.value, recorded, "recorded once");
  // Another learner on the same machine reads it.
  w.token = tok("learner-b");
  const writes = w.writes();
  assert.deepEqual(await w.session.submit(form()), { ok: false, message: PUBLISH_NOTICE_REQUIRED });
  assert.equal(w.writes(), writes);
  // A changed notice: a record for an older version does not count.
  const old = world({ store: { v: 1, acks: { [crBytesOwner(tok("learner-a"))]: { "publish-notice-2026-01-01": 1 } } } });
  assert.deepEqual(await old.session.submit(form()), { ok: false, message: PUBLISH_NOTICE_REQUIRED });
  assert.equal((await old.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION }))).ok, true);
  assert.deepEqual(Object.keys(old.box.value.acks[crBytesOwner(tok("learner-a"))]).sort(), ["publish-notice-2026-01-01", PUBLISH_NOTICE_VERSION].sort());
});

await test("N5 the panel view reports the notice for the signed-in learner", async () => {
  const w = world();
  assert.deepEqual((await w.session.view()).publish_notice, { version: PUBLISH_NOTICE_VERSION, acknowledged: false });
  await w.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION }));
  assert.deepEqual((await w.session.view()).publish_notice, { version: PUBLISH_NOTICE_VERSION, acknowledged: true });
  w.token = tok("learner-b");
  assert.deepEqual((await w.session.view()).publish_notice, { version: PUBLISH_NOTICE_VERSION, acknowledged: false });
  w.token = null;
  assert.equal((await w.session.view()).publish_notice, undefined, "no one signed in: no notice state");
});

await test("N6 fail closed: no port, no owner, an unsaved record, a malformed store", async () => {
  const none = world({ ledger: null });
  assert.deepEqual(await none.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION })), { ok: false, message: PUBLISH_NOTICE_REQUIRED });
  assert.equal(none.writes(), 0);
  const ownerless = world({ token: "not-a-token" });
  assert.deepEqual(await ownerless.session.submit(form()), { ok: false, message: PUBLISH_NOTICE_REQUIRED }, "a token without an owner has no acknowledgment");
  assert.deepEqual(await ownerless.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION })), { ok: false, message: PUBLISH_NOTICE_NOT_SAVED });
  assert.equal(ownerless.writes(), 0);
  const broken = world({ ledger: new PublishNoticeLedger({ get: () => undefined, update: () => { throw new Error("disk full"); } }, (t) => crBytesOwner(t)) });
  assert.deepEqual(await broken.session.submit(form({ notice_version: PUBLISH_NOTICE_VERSION })), { ok: false, message: PUBLISH_NOTICE_NOT_SAVED });
  assert.equal(broken.writes(), 0);
  const owner = crBytesOwner(tok("learner-a"));
  for (const bad of [null, [], "x", { v: 2, acks: {} }, { v: 1, acks: { [owner]: { [PUBLISH_NOTICE_VERSION]: "yes" } } }, { v: 1, acks: { "learner-a": { [PUBLISH_NOTICE_VERSION]: 1 } } }, { v: 1, acks: { [owner]: { [PUBLISH_NOTICE_VERSION]: -1 } } }]) {
    const w = world({ store: bad });
    assert.equal(w.ledger.acknowledged(w.token, PUBLISH_NOTICE_VERSION), false, `malformed ${JSON.stringify(bad)}`);
    assert.deepEqual(await w.session.submit(form()), { ok: false, message: PUBLISH_NOTICE_REQUIRED });
  }
  // Positive control for the parser: a well-formed record counts.
  const good = world({ store: { v: 1, acks: { [owner]: { [PUBLISH_NOTICE_VERSION]: 5 } } } });
  assert.equal((await good.session.submit(form())).ok, true);
});

await test("copy: three bullets, a versioned id", async () => {
  assert.equal(PUBLISH_NOTICE_LINES.length, 3);
  assert.match(PUBLISH_NOTICE_VERSION, /^[a-z0-9-]{1,64}$/);
  assert.equal(notice.PUBLISH_NOTICE_ACK, "알겠어요");
});

rmSync(root, { recursive: true, force: true });
console.log(`PASS publish-notice: ${passed} checks`);
