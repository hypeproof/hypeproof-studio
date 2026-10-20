// REQ-STUDIO-CAPABILITY-CHANGE (CGP-SHELL-R-024): when a profile refresh changes what the AI can
// do on a personal seat, one calm card in the chat says what was added and removed, once. No card
// at first load, for a change the card does not show, for the learner's own folder choice, or on a
// classroom / lesson / instructor / unknown seat.
//
// 1–4 are pure (capabilityChange.ts). 5 locks the wiring in chatPanelProvider.ts and protocol.ts.
// The card's markup is rendered in test/ai-can-do.test.tsx.
//
// Run: node --experimental-strip-types test/capability-change.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CC = await import("../src/capabilityChange.ts");
const { narrowForFolder } = await import("../src/folderConsent.ts");
const { AI_CAPABILITY_LABELS: L } = await import("../src/aiCapabilities.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };

const personal = { activity_kind: "personal", welcome: { greeting_md: "안녕" } };
const files = { ...personal, sdk_tools: { read: true, write: true, shell: true } };
const SDK = { settingRuntime: "agent-sdk", fallback: false };
const seat = (profile, extra = {}) => ({ scope: "tok|a1", profile, inputs: SDK, ...extra });
// A pass whose access choice allows only reading (accessClient.ts AccessChoiceView).
const readOnlyPass = { id: "pass-1", label: "이용권", mode: "included", source_kind: "pass", active: true, available: true, state: "active", ends_at: 0, can_request: false,
  allowed: { models: [], efforts: [], features: ["read"], runtimes: [] }, resources: [] };

// ── 1. Served keys and diff ──
{
  const PROXY = { settingRuntime: "proxy", fallback: false };
  assert.deepEqual(CC.seatCapabilityKeys(files, SDK), ["read", "write", "shell"]);
  assert.deepEqual(CC.seatCapabilityKeys(files, PROXY), [], "file and command grants do not count on proxy (REQ-M47)");
  assert.deepEqual(CC.seatCapabilityKeys(files, { ...SDK, fallback: true }), [], "after a fallback the turns run on proxy");
  assert.deepEqual(CC.seatCapabilityKeys({ ...files, tools: { web_search: true } }, { ...SDK, choice: readOnlyPass }), ["read"], "the access choice applies (and always strips web_search)");
  assert.deepEqual(CC.seatCapabilityKeys({ ...files, coach_runtime: "agent-sdk" }, PROXY), ["read", "write", "shell"], "a profile that asks for agent-sdk resolves to it");
  assert.deepEqual(CC.seatCapabilityKeys(null, SDK), []);
  const narrowed = narrowForFolder(files, "read");
  assert.equal(narrowed.sdk_tools.write, false, "fixture: the folder choice really turned write off");
  assert.deepEqual(CC.seatCapabilityKeys(narrowed, SDK), ["read", "write", "shell"], "folder narrowing is put back");
  assert.deepEqual(CC.seatCapabilityKeys({ ...personal, sdk_tools: { read: true } }, SDK), ["read"], "negative control: an un-narrowed off grant stays off");
  assert.deepEqual(CC.diffCapabilities(["read", "shell"], ["web_search", "read", "write"]), { added: ["write", "web_search"], removed: ["shell"] });
  // The REQ-M47 card and the change card share one evaluation: it equals the card's former formula.
  const { aiCapabilities } = await import("../src/aiCapabilities.ts");
  const { accessProfile } = await import("../src/accessClient.ts");
  const grantsAll = { ...personal, sdk_tools: { read: true, write: true, shell: true, subagents: true, browser: true }, tools: { web_search: true }, browser_control: { enabled: true } };
  for (const choice of [undefined, readOnlyPass]) for (const settingRuntime of ["proxy", "agent-sdk"]) for (const fallback of [false, true]) {
    const runtime = fallback ? "proxy" : settingRuntime;
    assert.deepEqual(CC.seatAiCapabilities(grantsAll, { choice, settingRuntime, fallback }), aiCapabilities(accessProfile(grantsAll, choice), runtime), JSON.stringify({ choice: !!choice, settingRuntime, fallback }));
  }
  ok("seat keys = the REQ-M47 card's evaluation (access choice, runtime, fallback), folder narrowing undone; diff in REQ-M38 order");
}

// ── 2. Seats: the stricter quiet rule (#2072 / #1890) ──
{
  for (const s of [{ activity_kind: "personal" }, { activity_kind: "trial" }, { pass: { id: "p" } }]) assert.equal(CC.capabilityChangeApplies(s), true, JSON.stringify(s));
  for (const s of [null, {}, { activity_kind: "classroom" }, { activity_kind: "personal", lesson: { content: {} } }, { activity_kind: "trial", lesson_binding: { enforced: true } }]) assert.equal(CC.capabilityChangeApplies(s), false, JSON.stringify(s));
  assert.equal(CC.capabilityChangeApplies({ activity_kind: "personal" }, true), false, "never on the instructor surface");
  ok("seats: personal / trial / pass; classroom, lesson-bound, unknown and instructor stay quiet");
}

// ── 3. The tracker: first load, invisible fields, added / removed, no repeat, folder choice ──
{
  const t = new CC.CapabilityChangeTracker();
  assert.equal(t.observe(seat(files)), null, "first load: no card");
  assert.equal(t.observe(seat(files)), null, "same profile again: no card");

  // Invisible fields: greeting, prompt, publishing, a proxy-only browser switch under agent-sdk.
  const invisible = { ...files, welcome: { greeting_md: "다른 인사" }, prompt: "다른 프롬프트", publishing: { enabled: true }, browser_control: { enabled: true } };
  assert.equal(t.observe(seat(invisible)), null, "invisible-field change: no card");

  // Added and removed.
  const changed = { ...personal, sdk_tools: { read: true, write: true, browser: true }, tools: { web_search: true } };
  const card = t.observe(seat(changed));
  assert.ok(card, "a capability change gives a card");
  assert.deepEqual(card.added, [L.browser, L.web_search]);
  assert.deepEqual(card.removed, [L.shell]);
  assert.equal(card.added[1], "웹에서 찾아보기");
  assert.equal(card.removed[0], "명령 실행하기");

  // Shown once: re-posting the same profile keeps the same card (same id), not a second one.
  const again = t.observe(seat(changed));
  assert.equal(again?.id, card.id, "the open card is the same card, not a new one");
  t.dismiss("stale-id");
  assert.equal(t.observe(seat(changed))?.id, card.id, "negative control: a stale id does not dismiss");
  t.dismiss(card.id);
  assert.equal(t.observe(seat(changed)), null, "after dismiss: the same profile on a later refresh shows nothing");
  assert.equal(t.observe(seat(changed)), null, "and still nothing on the next refresh");

  // The learner's own folder choice: narrowing write/shell is not a lesson change.
  const t2 = new CC.CapabilityChangeTracker();
  t2.observe(seat(files));
  assert.equal(t2.observe(seat(narrowForFolder(files, "read"))), null, "folder-consent narrowing: no card");
  assert.ok(t2.observe(seat({ ...files, sdk_tools: { read: true, write: true } })), "negative control: the same keys turned off by the profile itself do give a card");
  ok("tracker: none at first load, none for invisible fields, one card with the right lists, no repeat after dismiss, none for the folder choice");
}

// ── 4. Edges: undo, quiet seats, scope change, local, unresolved ──
{
  const t = new CC.CapabilityChangeTracker();
  t.observe(seat(files));
  assert.ok(t.observe(seat({ ...files, sdk_tools: { read: true } })));
  assert.equal(t.observe(seat(files)), null, "a change undone before dismissal clears the card");

  const cls = { ...files, activity_kind: "classroom" };
  const c = new CC.CapabilityChangeTracker();
  c.observe(seat(cls));
  assert.equal(c.observe(seat({ ...cls, sdk_tools: { read: true } })), null, "classroom seat: no card");
  assert.equal(c.observe(seat({ ...cls, sdk_tools: { read: true } }, { instructor: true })), null, "instructor: no card");

  const s = new CC.CapabilityChangeTracker();
  s.observe(seat(files));
  assert.equal(s.observe(seat({ ...personal, tools: { web_search: true } }, { scope: "other|a2" })), null, "another token or activity is a first load");
  assert.equal(s.observe(seat({ ...personal, sdk_tools: { read: true } }, { scope: "other|a2", local: true })), null, "local runtime: no card");

  const u = new CC.CapabilityChangeTracker();
  u.observe(seat(files));
  const pending = u.observe(seat({ ...files, sdk_tools: { read: true } }));
  assert.equal(u.observe({ ...seat(null) })?.id, pending.id, "an unresolved refresh keeps the open card and changes nothing");
  // F1 — the learner's access choice masks a profile change: no card for what the card does not show.
  const p1 = new CC.CapabilityChangeTracker();
  const pass = { scope: "tok|a1", inputs: { ...SDK, choice: readOnlyPass } };
  p1.observe({ ...pass, profile: { ...personal, sdk_tools: { read: true } } });
  assert.equal(p1.observe({ ...pass, profile: { ...personal, sdk_tools: { read: true, write: true }, tools: { web_search: true } } }), null, "access choice ['read'] + profile adds write and web_search: no card");
  assert.equal(p1.observe({ ...pass, profile: { ...personal, sdk_tools: {} } })?.removed.join(), L.read, "negative control: removing the one allowed key does show");
  // F1 — after an agent-sdk -> proxy fallback, a profile adding write cannot be used: no card.
  const f1 = new CC.CapabilityChangeTracker();
  const fb = { scope: "tok|a1", inputs: { ...SDK, fallback: true } };
  f1.observe({ ...fb, profile: { ...personal, sdk_tools: { read: true } } });
  assert.equal(f1.observe({ ...fb, profile: { ...personal, sdk_tools: { read: true, write: true } } }), null, "fallback + profile adds write: no card");
  assert.ok(f1.observe({ ...fb, profile: { ...personal, sdk_tools: { read: true, write: true }, tools: { web_search: true } } }), "negative control: web_search works on proxy and does show");
  // Choice, setting or fallback changes alone never make a card (F2 and the inverse of F1).
  const f2 = new CC.CapabilityChangeTracker();
  f2.observe(seat(files));
  assert.equal(f2.observe(seat(files, { inputs: { settingRuntime: "proxy", fallback: false } })), null, "coachRuntime setting flip alone: no card");
  assert.equal(f2.observe(seat(files, { inputs: { ...SDK, fallback: true } })), null, "fallback alone: no card");
  assert.equal(f2.observe(seat(files, { inputs: { ...SDK, choice: readOnlyPass } })), null, "access choice alone: no card");
  ok("edges: access choice, fallback and setting mask or never fire; undo clears, classroom and instructor quiet, new scope is a first load, local quiet, unresolved keeps state");
}

// ── 5. Wiring ──
{
  const src = fs.readFileSync(path.join(extRoot, "src/chatPanelProvider.ts"), "utf8");
  assert.match(src, /from ['"]\.\/capabilityChange['"]/, "chatPanelProvider imports the module");
  assert.doesNotMatch(src, /get capabilityChanges\(\)/, "no getter: fixtures call postConfig on a plain object");
  const post = src.indexOf("private async postConfig(): Promise<void> {");
  const observe = src.indexOf("(this.capChanges ??= new CapabilityChangeTracker()).observe(", post);
  assert.ok(post > 0 && observe > post, "observed in postConfig");
  const line = src.slice(observe, src.indexOf("\n", observe));
  assert.match(line, /profile,/, "the served profile (not the access- or folder-narrowed one)");
  assert.doesNotMatch(line, /toolProfile|folderConsentProfile/, "never the narrowed profile");
  assert.match(line, /inputs: seatInputs/, "evaluated under the card's own inputs");
  assert.match(line, /instructor: isInstructor/);
  assert.match(line, /local: !!local/);
  assert.equal(src.split("(this.capChanges ??= new CapabilityChangeTracker()).observe(").length - 1, 1, "one observation site");
  assert.match(src, /capabilityChange && !isInstructor \? \{ capabilityChange \} : \{\}/, "config carries the card");
  // F1 — the REQ-M47 card is drawn from the same evaluation and the same inputs.
  assert.match(src, /\{ aiCapabilities: seatAiCapabilities\(profile, seatInputs\) \}/, "REQ-M47 card uses seatAiCapabilities");
  assert.doesNotMatch(src, /aiCapabilities\(toolProfile/, "no second evaluation of the card");
  const inputs = src.slice(src.indexOf("const seatInputs: SeatInputs = {", post));
  const inputsLine = inputs.slice(0, inputs.indexOf("\n"));
  assert.match(inputsLine, /choice: this\.accessState\?\.view\?\.choices\.find\(choice => choice\.id === this\.accessState\?\.selected\)/);
  assert.match(inputsLine, /settingRuntime: cfg\.get<'proxy' \| 'agent-sdk'>\('coachRuntime', 'proxy'\)/);
  assert.match(inputsLine, /fallback: !!this\.fallbackNoticeShown/);
  // F3 — forced re-reads republish the config before the next model call.
  assert.match(src, /async refreshProfileAndConfig\(\): Promise<ResolvedProfile \| null> \{\s*const profile = await this\.ensureProfile\(true\);\s*\/\/[^\n]*\n\s*await this\.postConfig\(\)\.catch\([^\n]*\);\s*return profile;/, "refreshProfileAndConfig posts the config (a failed republish does not stop the caller)");
  assert.match(src, /const profile = await this\.refreshProfileAndConfig\(\);\s*const token = await this\.context\.secrets\.get\(TOKEN_KEY\);\s*const cwd = /, "image edit refresh goes through postConfig");
  const ext = fs.readFileSync(path.join(extRoot, "src/extension.ts"), "utf8");
  assert.match(ext, /refreshProfile: async \(\) => !!\(await provider\.refreshProfileAndConfig\(\)\),/, "ops refreshProfile goes through postConfig");
  assert.doesNotMatch(ext, /refreshProfile: async \(\) => !!\(await provider\.ensureProfile\(true\)\)/);
  assert.match(src, /case "dismissCapabilityChange":\s*\n\s*\(this\.capChanges \?\?= new CapabilityChangeTracker\(\)\)\.dismiss\(msg\.id\);/, "dismiss reaches the tracker");
  const proto = fs.readFileSync(path.join(extRoot, "src/protocol.ts"), "utf8");
  assert.match(proto, /capabilityChange\?: import\(['"]\.\/aiCapabilities['"]\)\.CapabilityChange;/);
  assert.match(proto, /\{ type: "dismissCapabilityChange"; id: string \}/);
  ok("wiring: one observation in postConfig under the REQ-M47 card's inputs, one evaluation for both cards, forced re-reads post the config, dismiss handled");
}

console.log(`\ncapability-change: ${passed} checks passed`);
