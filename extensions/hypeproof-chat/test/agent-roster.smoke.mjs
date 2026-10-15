// A4 (spec §2.1, §2.2): the served-roster parser. Positive control: the §2.2 served example
// parses into exactly the agents it names. Negative controls: every field that decides
// what leaves the machine or what the coach may do refuses the whole roster when wrong.
// Display copy is cleaned instead of refused, so a long title cannot make the roster inert.
// A drift lock keeps the parser and A2's orchestratorBindingFor in agreement on identity.
//
// Run: node --experimental-strip-types test/agent-roster.smoke.mjs

import assert from "node:assert/strict";

const { parseServedRoster, consultableAgents, rosterAgent, rosterKey, agentLabel, ROSTER_AGENTS_MAX, TITLE_MAX, COACH_BRIEF_MAX } =
  await import("../src/agentRoster.ts");
const { orchestratorBindingFor, ORCHESTRATOR_FORMAT } = await import("../src/sdkCoachHelpers.ts");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

/** The served shape of spec §2.2, verbatim apart from the elided strings. */
const SERVED = {
  format: "hps-agent-roster/1",
  id: "homepage",
  version: "1.0.0",
  digest: "sha256:" + "0123456789abcdef".repeat(4),
  coach_brief: "검토가 필요하면 검토 도우미에게 물어보세요.\n도우미의 의견을 쓸 때는 누구의 의견인지 밝혀 말하세요.",
  checks: ["site_check", "diff_guard", "archive_before_overwrite"],
  agents: [
    { name: "coach", title: "코치", role: "coach" },
    {
      name: "design-reviewer", title: "검토 도우미", role: "helper", purpose: "첫 페이지나 새 섹션을 품질 기준으로 검토한다.",
      trigger: "coach_consult", context: ["file_excerpt", "site_check", "learner_goal"],
      caps: { per_turn: 1, per_session: 6 }, enabled: true, model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    },
    {
      name: "design-advisor", title: "설계 자문", role: "advisor", trigger: "deterministic_failure",
      caps: { per_turn: 1, per_session: 2 }, enabled: false, model: { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    },
  ],
};
const clone = () => structuredClone(SERVED);
const refused = (mutate) => {
  const v = clone();
  mutate(v);
  const r = parseServedRoster(v);
  assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(v).slice(0, 160)}`);
  assert.equal(typeof r.reason, "string");
  assert.ok(r.reason.length > 0);
  return r.reason;
};

// ── Positive control: the served example ────────────────────────────────────
{
  const r = parseServedRoster(clone());
  assert.equal(r.ok, true, r.reason);
  const roster = r.roster;
  assert.equal(roster.format, ORCHESTRATOR_FORMAT);
  assert.equal(rosterKey(roster), "homepage@1.0.0");
  assert.equal(roster.digest, SERVED.digest);
  assert.deepEqual(roster.checks, ["site_check", "diff_guard", "archive_before_overwrite"]);
  assert.match(roster.coach_brief, /검토 도우미에게 물어보세요\.\n도우미의 의견을/, "the brief keeps its line break");
  assert.deepEqual(roster.agents.map((a) => [a.name, a.role, a.enabled]), [
    ["coach", "coach", false],
    ["design-reviewer", "helper", true],
    ["design-advisor", "advisor", false],
  ]);
  const reviewer = rosterAgent(roster, "design-reviewer");
  assert.deepEqual(reviewer, {
    name: "design-reviewer", title: "검토 도우미", role: "helper", purpose: "첫 페이지나 새 섹션을 품질 기준으로 검토한다.",
    trigger: "coach_consult", context: ["file_excerpt", "site_check", "learner_goal"],
    caps: { per_turn: 1, per_session: 6 }, enabled: true, model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  });
  // §2.2 serves the advisor without purpose or context: both default to empty.
  const advisor = rosterAgent(roster, "design-advisor");
  assert.equal(advisor.purpose, "");
  assert.deepEqual(advisor.context, []);
  assert.deepEqual(consultableAgents(roster).map((a) => a.name), ["design-reviewer"], "the disabled advisor is not consultable");
  assert.equal(agentLabel(reviewer), "검토 도우미 · Claude Haiku 5.5");
  assert.equal(agentLabel({ title: "도우미", model: null }), "도우미");
  ok("the §2.2 served example parses: identity, checks, brief, agents; only the enabled helper is consultable");
}

// ── Not a roster ────────────────────────────────────────────────────────────
{
  assert.deepEqual(parseServedRoster(undefined), { ok: false, reason: "absent" });
  assert.deepEqual(parseServedRoster(null), { ok: false, reason: "absent" });
  assert.deepEqual(parseServedRoster({ enabled: false, reason: "flag_off" }), { ok: false, reason: "served off: flag_off" });
  assert.deepEqual(parseServedRoster({ enabled: false }), { ok: false, reason: "served off" });
  for (const v of ["roster", 3, true, []]) assert.equal(parseServedRoster(v).ok, false, `${JSON.stringify(v)} is not a roster`);
  // A disabled flag wins even on an otherwise good roster.
  assert.equal(parseServedRoster({ ...clone(), enabled: false }).ok, false);
  ok("absent, null, the disabled form and non-objects are not rosters");
}

// ── Negative controls: what decides behavior refuses the whole roster ───────
{
  refused((v) => (v.format = "hps-agent-roster/2"));
  refused((v) => delete v.format);
  for (const id of ["Homepage", "home page", "homepage\nx-evil: 1", "", "9home", "a".repeat(41)]) refused((v) => (v.id = id));
  for (const version of ["1.0", "1.0.0\n", "1.0.0 ", "v1.0.0", "1.0.0-", "1.0.0-" + "x".repeat(33), 1]) refused((v) => (v.version = version));
  refused((v) => (v.agents = {}));
  refused((v) => (v.agents = []));
  refused((v) => (v.agents = Array.from({ length: ROSTER_AGENTS_MAX + 1 }, (_, i) => ({ name: i ? `helper-${i}` : "coach", title: "t", role: i ? "aux" : "coach" }))));
  refused((v) => (v.agents = v.agents.slice(1)));
  refused((v) => v.agents.push({ name: "coach-2", title: "코치2", role: "coach" }));
  refused((v) => (v.agents[0].name = "teacher"));
  refused((v) => v.agents.push({ name: "aux", role: "aux" }, { name: "aux-2", role: "aux" }));
  refused((v) => (v.agents[1].role = "director"));
  refused((v) => (v.agents[1].name = "Design-Reviewer"));
  refused((v) => (v.agents[1].name = "d"));
  refused((v) => (v.agents[1].name = "design/reviewer"));
  refused((v) => (v.agents[1].name = "x".repeat(41)));
  refused((v) => (v.agents[2].name = "design-reviewer"));
  refused((v) => delete v.agents[1].trigger);
  refused((v) => (v.agents[1].trigger = "learner"));
  refused((v) => (v.agents[1].trigger = "whenever"));
  refused((v) => (v.agents[2].trigger = "coach_consult"));
  refused((v) => (v.agents[1].context = ["file_excerpt", "transcript"]));
  refused((v) => (v.agents[1].context = "file_excerpt"));
  refused((v) => delete v.agents[1].caps);
  for (const caps of [{ per_turn: -1, per_session: 6 }, { per_turn: 1.5, per_session: 6 }, { per_turn: 1, per_session: 101 }, { per_turn: "1", per_session: 6 }, { per_turn: 1 }])
    refused((v) => (v.agents[1].caps = caps));
  refused((v) => (v.agents[1].enabled = "true"));
  refused((v) => (v.checks = "site_check"));
  ok("refused whole: format, header-unsafe id or version, agent list, coach count and name, roles, names, triggers, context keys, caps, enabled, checks type");
}

// ── Display copy is cleaned, not refused ────────────────────────────────────
{
  const v = clone();
  v.agents[1].title = "검토\u0000 도우미\n" + "가".repeat(80);
  v.agents[1].purpose = "  여러\t줄\n목적  ";
  v.agents[1].model.label = "Claude\u0007 Haiku 5.5";
  v.coach_brief = "첫 줄\r\n\r\n\r\n\r\n둘째 줄\u0001" + "나".repeat(COACH_BRIEF_MAX);
  v.checks = ["site_check", "contrast_check", "site_check", 7];
  v.digest = "md5:abc";
  v.agents[1].extra_field = { ignored: true };
  v.unknown_top_level = 1;
  delete v.agents[1].title;
  v.agents[2].title = "설계\u2028자문";
  const r = parseServedRoster(v);
  assert.equal(r.ok, true, r.reason);
  const reviewer = rosterAgent(r.roster, "design-reviewer");
  assert.equal(reviewer.title, "design-reviewer", "a missing title falls back to the wire name");
  assert.equal(rosterAgent(r.roster, "design-advisor").title, "설계 자문", "a line separator in a title is a space");
  assert.equal(reviewer.purpose, "여러 줄 목적");
  assert.equal(reviewer.model.label, "Claude Haiku 5.5");
  assert.ok(r.roster.coach_brief.length <= COACH_BRIEF_MAX);
  assert.ok(r.roster.coach_brief.startsWith("첫 줄\n\n둘째 줄 "), "CRLF normalised, runs of blank lines collapsed, control characters out");
  assert.deepEqual(r.roster.checks, ["site_check"], "unknown and duplicate checks are dropped");
  assert.equal(r.roster.digest, null, "a malformed digest is dropped, not trusted");
  assert.equal("extra_field" in reviewer, false);

  const long = clone();
  long.agents[1].title = "가".repeat(100);
  const rl = parseServedRoster(long);
  assert.equal(rosterAgent(rl.roster, "design-reviewer").title.length, TITLE_MAX);
  // A served model id that is not an id gives no label rather than a refusal.
  const badModel = clone();
  badModel.agents[1].model = { id: "claude haiku", label: "x" };
  assert.equal(rosterAgent(parseServedRoster(badModel).roster, "design-reviewer").model, null);
  ok("display copy: control characters and line breaks out, clipped to its limit, a missing title falls back to the name; unknown checks, keys and a malformed digest dropped");
}

// ── Consultable agents ──────────────────────────────────────────────────────
{
  const v = clone();
  v.agents[2].enabled = true;
  assert.deepEqual(consultableAgents(parseServedRoster(v).roster).map((a) => a.name), ["design-reviewer", "design-advisor"]);
  v.agents[1].caps = { per_turn: 0, per_session: 6 };
  assert.deepEqual(consultableAgents(parseServedRoster(v).roster).map((a) => a.name), ["design-advisor"], "a cap of zero is not consultable");
  v.agents.push({ name: "aux", title: "보조", role: "aux", trigger: "cli_background", enabled: true });
  assert.deepEqual(consultableAgents(parseServedRoster(v).roster).map((a) => a.name), ["design-advisor"], "aux and coach are never consultable");
  ok("consultable = enabled helper or advisor with both caps above zero; never the coach or aux");
}

// ── Drift lock: the parser and A2's binding agree on identity ───────────────
{
  const adult = { game: { template_tier: "website" } };
  const ids = ["homepage", "a", "home-page-2", "Homepage", "home page", "x".repeat(40), "x".repeat(41), "9a", "a_b"];
  const versions = ["1.0.0", "0.0.1", "10.20.30", "1.0.0-rc.1", "1.0", "1.0.0.0", "01.0.0", "1.0.0-", "1.0.0+build"];
  let compared = 0;
  for (const id of ids) {
    for (const version of versions) {
      const v = { ...clone(), id, version };
      const parsed = parseServedRoster(v).ok;
      const bound = orchestratorBindingFor(adult, v) !== null;
      assert.equal(parsed, bound, `parser and binding disagree on ${id}@${version}`);
      compared++;
    }
  }
  // Both sides really accept and refuse something (otherwise agreement proves nothing).
  assert.equal(parseServedRoster({ ...clone(), id: "homepage", version: "1.0.0" }).ok, true);
  assert.equal(parseServedRoster({ ...clone(), id: "home page", version: "1.0.0" }).ok, false);
  // The binding strips minors whatever the parser says (the parser is profile-agnostic).
  assert.equal(orchestratorBindingFor({ game: { template_tier: "kids-basic" } }, clone()), null);
  assert.equal(orchestratorBindingFor({ minor_cohort: true, game: { template_tier: "website" } }, clone()), null);
  ok(`drift lock: parser and A2 binding agree on ${compared} id/version pairs; the binding still strips minors`);
}

console.log(`\n${passed} agent-roster checks passed`);
