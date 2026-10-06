// #1404 — the synthetic release-acceptance cohort, through the real routes.
//
// Three behaviors, each with the control that makes it mean something:
//   1. GET /admin/cohorts reports `synthetic` from the compiled profiles. The
//      freeze reads only that field, so the real cohorts must say false.
//   2. A synthetic cohort refuses every roster write and token mint whose
//      handle is outside `synthetic-`. Control: a real cohort still accepts the
//      same handle, so the refusal is not a route that refuses everything.
//   3. The per-run acceptance flow works with a scoped issuer: open a session
//      (classroom code), mint a trial code for the same fresh handle, read both
//      as the App does, close. A second run's fresh handle gets a fresh trial
//      allowance even after the first one started — the defect #1404 names.
import "./harness/loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { localAuthoring } from "./harness/dental-authoring.mjs";
import { TEST_SECRET } from "./harness/index.mjs";
const { issueIssuer, verify } = await import("../src/lib/tokens.ts");
const { readNativeGrant } = await import("../src/lib/native-trial-grants.ts");

const ID = "synthetic-release-acceptance";
const ADMIN = "Basic " + btoa(":synthetic-admin-password");

async function fixture() {
  const local = await localAuthoring({ profileId: ID });
  local.db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  local.db.exec(readFileSync(new URL("../migrations/0004-native-trials.sql", import.meta.url), "utf8"));
  local.env.HPS_ADMIN_PASSWORD = "synthetic-admin-password";
  local.env.HPS_DB.batch = async (statements) => Promise.all(statements.map((s) => s.run()));
  const call = async (path, { method = "GET", body, auth = ADMIN } = {}) => {
    const res = await local.fetcher(local.origin + path, {
      method,
      headers: { authorization: auth, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { ...local, call };
}

test("GET /admin/cohorts reports the synthetic cohort, and only it", async () => {
  const f = await fixture();
  try {
    const { status, json } = await f.call("/admin/cohorts");
    assert.equal(status, 200);
    const flagged = json.cohorts.filter((c) => c.synthetic === true).map((c) => c.id);
    assert.deepEqual(flagged, [ID]);
    // Every other cohort carries an explicit false — including the canary,
    // which is also robot-only but is not declared synthetic.
    for (const c of json.cohorts) if (c.id !== ID) assert.equal(c.synthetic, false, c.id);
  } finally { f.close(); }
});

test("a synthetic cohort refuses a non-synthetic handle on every roster write and mint", async () => {
  const f = await fixture();
  try {
    const refusals = {
      "roster replace": await f.call(`/admin/cohorts/${ID}/roster`, { method: "POST", body: { users: ["synthetic-ok", "student-kim"] } }),
      "roster append": await f.call(`/admin/cohorts/${ID}/roster/append`, { method: "POST", body: { users: ["student-kim"] } }),
      "session open": await f.call(`/admin/cohorts/${ID}/session/open`, { method: "POST", body: { profile_id: ID, user: "student-kim", session_hours: 1, token_hours: 1 } }),
      "token mint": await f.call("/admin/tokens/issue", { method: "POST", body: { u: "student-kim", c: ID, p: ID, hours: 1 } }),
      "bare prefix": await f.call(`/admin/cohorts/${ID}/roster/append`, { method: "POST", body: { users: ["synthetic-"] } }),
    };
    for (const [label, r] of Object.entries(refusals)) {
      assert.equal(r.status, 400, label);
      assert.equal(r.json.code, "synthetic_handle_required", label);
    }
    assert.deepEqual(refusals["roster replace"].json.refused, ["student-kim"]);
    // Nothing reached the roster or the session key.
    assert.equal(await f.env.HPS_KV.get(`cohort:${ID}:roster`), null);
    assert.equal(await f.env.HPS_KV.get(`cohort:${ID}:active_session`), null);

    // Control: the same handle on a real cohort is not refused by this rule.
    const real = await f.call("/admin/cohorts/homepage-practice/roster/append", { method: "POST", body: { users: ["student-kim"] } });
    assert.equal(real.status, 200);
    // And the synthetic namespace is accepted on the synthetic cohort.
    const ok = await f.call(`/admin/cohorts/${ID}/roster/append`, { method: "POST", body: { users: ["synthetic-ok"] } });
    assert.equal(ok.status, 200);
  } finally { f.close(); }
});

test("per-run acceptance: scoped issuer opens, mints both codes for a fresh handle, closes", async () => {
  const f = await fixture();
  try {
    const issuer = "Bearer " + (await issueIssuer({
      issuer: "synthetic-release-acceptance-ci",
      scopes: [{ cohort: ID, profiles: [ID], max_hours: 1, can_start_session: true, max_session_hours: 1 }],
    }, 24 * 30, TEST_SECRET)).token;

    const run = async (user) => {
      const open = await f.call(`/admin/cohorts/${ID}/session/open`, {
        method: "POST", auth: issuer,
        body: { profile_id: ID, user, session_hours: 1, token_hours: 1, force: true },
      });
      assert.equal(open.status, 200, JSON.stringify(open.json));
      const trial = await f.call("/admin/tokens/issue", {
        method: "POST", auth: issuer,
        body: { u: user, c: ID, p: ID, hours: 1, native_trial: true },
      });
      assert.equal(trial.status, 200, JSON.stringify(trial.json));
      const kinds = {};
      for (const [name, token] of [["classroom", open.json.token], ["trial", trial.json.token]]) {
        const r = await f.call("/v1/profile", { auth: "Bearer " + token });
        assert.equal(r.status, 200, name + " " + JSON.stringify(r.json));
        assert.equal(r.json.profile_id, ID);
        kinds[name] = r.json.activity_kind;
      }
      assert.deepEqual(kinds, { classroom: "classroom", trial: "trial" });
      return { open: open.json, trial: await verify(trial.json.token, TEST_SECRET) };
    };

    const first = await run("synthetic-acceptance-run-1");
    const firstGrant = await readNativeGrant(f.env, first.trial);
    assert.ok(firstGrant.started_at, "reading the trial profile started the first allowance");

    // The next release's run: a fresh handle, so a fresh, unstarted allowance.
    const second = await run("synthetic-acceptance-run-2");
    const secondGrant = await readNativeGrant(f.env, second.trial);
    assert.notEqual(secondGrant.id, firstGrant.id);
    assert.equal(secondGrant.requests_used, 0);

    const close = await f.call(`/admin/cohorts/${ID}/session/close`, {
      method: "POST", auth: issuer, body: { jti: second.open.jti, exp: second.open.exp },
    });
    assert.equal(close.status, 200);
    assert.equal(close.json.revoked, second.open.jti);
    assert.equal(await f.env.HPS_KV.get(`cohort:${ID}:active_session`), null);
  } finally { f.close(); }
});
