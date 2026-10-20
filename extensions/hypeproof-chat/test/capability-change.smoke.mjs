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
const seat = (profile, extra = {}) => ({ scope: "tok|a1", profile, runtime: "agent-sdk", ...extra });

// ── 1. Served keys and diff ──
{
  assert.deepEqual(CC.servedCapabilityKeys(files, "agent-sdk"), ["read", "write", "shell"]);
  assert.deepEqual(CC.servedCapabilityKeys(files, "proxy"), [], "file and command grants do not count on proxy (REQ-M47)");
  assert.deepEqual(CC.servedCapabilityKeys(null, "agent-sdk"), []);
  const narrowed = narrowForFolder(files, "read");
  assert.equal(narrowed.sdk_tools.write, false, "fixture: the folder choice really turned write off");
  assert.deepEqual(CC.servedCapabilityKeys(narrowed, "agent-sdk"), ["read", "write", "shell"], "folder narrowing is put back");
  assert.deepEqual(CC.servedCapabilityKeys({ ...personal, sdk_tools: { read: true } }, "agent-sdk"), ["read"], "negative control: an un-narrowed off grant stays off");
  assert.deepEqual(CC.diffCapabilities(["read", "shell"], ["web_search", "read", "write"]), { added: ["write", "web_search"], removed: ["shell"] });
  ok("served keys follow aiCapabilities and undo only the folder narrowing; diff in REQ-M38 order");
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

  // Invisible fields: greeting, model list, publishing, a proxy-only browser switch under agent-sdk.
  const invisible = { ...files, welcome: { greeting_md: "다른 인사" }, model_selection: { models: ["x"] }, publishing: { enabled: true }, browser_control: { enabled: true } };
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
  ok("edges: undo clears, classroom and instructor quiet, new scope is a first load, local quiet, unresolved keeps state");
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
  assert.match(line, /runtime: toolRuntime/);
  assert.match(line, /instructor: isInstructor/);
  assert.match(line, /local: !!local/);
  assert.equal(src.split("(this.capChanges ??= new CapabilityChangeTracker()).observe(").length - 1, 1, "one observation site");
  assert.match(src, /capabilityChange && !isInstructor \? \{ capabilityChange \} : \{\}/, "config carries the card");
  assert.match(src, /case "dismissCapabilityChange":\s*\n\s*\(this\.capChanges \?\?= new CapabilityChangeTracker\(\)\)\.dismiss\(msg\.id\);/, "dismiss reaches the tracker");
  const proto = fs.readFileSync(path.join(extRoot, "src/protocol.ts"), "utf8");
  assert.match(proto, /capabilityChange\?: import\(['"]\.\/aiCapabilities['"]\)\.CapabilityChange;/);
  assert.match(proto, /\{ type: "dismissCapabilityChange"; id: string \}/);
  ok("wiring: one observation in postConfig with the served profile, card in config, dismiss handled");
}

console.log(`\ncapability-change: ${passed} checks passed`);
