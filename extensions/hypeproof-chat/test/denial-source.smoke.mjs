// REQ-STUDIO-DENIAL-SOURCE (CGP-AGENT-R-007, extends AE-12): every denied tool call or
// disabled feature names its source — 수업 설정 / 안전 규칙 / 앱 버전/환경 — or says 확인 안 됨
// when the site cannot tell. Pure: the copy builder, the classifier, the tool gate's
// verdicts, and a source scan proving no denial site still emits an old ad-hoc sentence.
//
// Run: node --experimental-strip-types test/denial-source.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DS = await import("../src/denialSource.ts");
const H = await import("../src/sdkCoachHelpers.ts");
const { CLASSROOM_ONLY_WORDS } = await import("../src/seatVocabulary.ts");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

/** Learner copy carries no English identifier (a tool name, a code, a camelCase key). "Studio" is the product's name. */
const IDENTIFIER = /[A-Za-z_]{3,}/;
const ENGLISH_IDENTIFIER = { test: (s) => IDENTIFIER.test(s.replaceAll("Studio", "")) };
const TEACHER_WORDS = ["선생님", ...CLASSROOM_ONLY_WORDS];

// ── 1. The classifier: every listed cause has its source; anything else is unknown ──
{
  const expected = {
    profile_tool_not_granted: "lesson",
    lesson_feature_off: "lesson",
    never_for_learners: "safety",
    path_outside_workspace: "safety",
    url_policy: "safety",
    outside_preview_scope: "safety",
    subagent_not_in_catalog: "safety",
    minor_protection: "safety",
    moderation: "safety",
    tool_drift: "runtime",
    runtime_unsupported: "runtime",
    sdk_missing: "runtime",
    binary_missing: "runtime",
    needs_newer_app: "runtime",
    access_choice_narrowed: "access",
  };
  assert.deepEqual({ ...DS.DENIAL_CAUSES }, expected, "the cause table is exactly the reviewed one");
  for (const [cause, source] of Object.entries(expected)) assert.equal(DS.classifyDenial(cause), source, cause);
  // Negative controls: nothing outside the table is guessed into a category.
  for (const cause of [undefined, null, "", "not_found", "malformed_call", "orchestrator_off", "toString", "__proto__", "LESSON_FEATURE_OFF"]) {
    assert.equal(DS.classifyDenial(cause), "unknown", `${String(cause)} → unknown`);
  }
  ok("classifier: 15 causes map to their source; unknown codes, prototype keys and casing variants → unknown");
}

// ── 2. The copy: one frame per source, one next step, seat-aware ──
{
  const lesson = DS.denialCopy({ source: "lesson", feature: "커리큘럼 스킬" });
  assert.equal(lesson, "이 수업에서는 커리큘럼 스킬을 쓰지 않도록 정해져 있어요. 필요하면 선생님께 이야기해 주세요.");
  assert.equal(DS.lessonFeatureOff("주간 리뷰"), "이 수업에서는 주간 리뷰를 쓰지 않도록 정해져 있어요. 필요하면 선생님께 이야기해 주세요.", "을/를 follows the last syllable");
  const lessonSolo = DS.denialCopy({ source: "lesson", feature: "커리큘럼 스킬" }, "solo");
  assert.equal(lessonSolo, "지금 활동에서는 커리큘럼 스킬을 쓰지 않도록 정해져 있어요. 다른 방법으로 이어서 해 볼 수 있어요.");

  const safety = DS.denialCopy({ source: "safety", reason: "작업 폴더 밖의 파일이에요" });
  assert.equal(safety, "안전을 위해 Studio가 막았어요 — 작업 폴더 밖의 파일이에요. 궁금하면 선생님께 물어봐 주세요.");
  assert.equal(DS.denialCopy({ source: "safety", reason: "작업 폴더 밖의 파일이에요" }, "solo"),
    "안전을 위해 Studio가 막았어요 — 작업 폴더 밖의 파일이에요. 궁금하면 ‘문제 신고하기’로 알려 주세요.");
  // The safety next step never invites a workaround.
  for (const a of ["classroom", "solo", "neutral"]) assert.doesNotMatch(DS.denialCopy({ source: "safety" }, a), /다른 방법|우회해|대신/);

  const access = DS.denialCopy({ source: "access", feature: "웹 검색" });
  assert.equal(access, "지금 고른 이용권에서는 웹 검색을 쓸 수 없어요. 다른 이용권을 고르거나 이 기능 없이 이어서 해 주세요.");
  assert.equal(DS.denialCopy({ source: "access", feature: "웹 검색" }, "solo"), access, "access copy has no seat words");
  assert.ok(!access.includes("수업"), "an 이용권 removal never says the lesson decided");

  // Neutral (a backstop that does not know the seat): seat-free wording, never a teacher.
  assert.equal(DS.lessonFeatureOff("요소 고르기", "neutral"), "지금 활동에서는 요소 고르기를 쓰지 않도록 정해져 있어요. 다른 방법으로 이어서 해 볼 수 있어요.");

  const runtime = DS.denialCopy({ source: "runtime", reason: "이 앱이 아직 모르는 도구예요" });
  assert.equal(runtime, "이 기능은 지금 앱에서 쓸 수 없어요 — 이 앱이 아직 모르는 도구예요. 앱을 업데이트하거나 선생님께 알려 주세요.");
  const runtimeSolo = DS.denialCopy({ source: "runtime", reason: "이 앱이 아직 모르는 도구예요" }, "solo");
  assert.equal(runtimeSolo, "이 기능은 지금 앱에서 쓸 수 없어요 — 이 앱이 아직 모르는 도구예요. 앱을 업데이트하거나 ‘문제 신고하기’로 알려 주세요.");

  const unknown = DS.denialCopy({ source: "unknown", feature: "요소 고르기" });
  assert.equal(unknown, "지금은 요소 고르기를 쓸 수 없어요 — 왜 막혔는지 Studio가 확인하지 못했어요. 계속되면 선생님께 알려 주세요.");
  const unknownSolo = DS.denialCopy({ source: "unknown", feature: "요소 고르기" }, "solo");
  assert.match(unknownSolo, /‘문제 신고하기’로 알려 주세요\.$/);
  // An unknown source never borrows another category's frame.
  for (const frame of ["이 수업에서는", "안전을 위해", "앱을 업데이트"]) assert.ok(!unknown.includes(frame), `unknown copy does not claim "${frame}"`);

  // The three sources' sentences are distinct, and each has exactly one next step.
  const all = [lesson, safety, runtime, access, unknown];
  assert.equal(new Set(all).size, 5);
  for (const s of all) assert.equal(s.split(/(?<=[.])\s/).length, 2, `one reason sentence + one next step: ${s}`);

  // Solo seats never see a teacher or staff word.
  const neutral = ["lesson", "safety", "runtime", "access", "unknown"].map((source) => DS.denialCopy({ source }, "neutral"));
  for (const s of [lessonSolo, runtimeSolo, unknownSolo, DS.denialCopy({ source: "safety" }, "solo"), ...neutral]) {
    for (const w of TEACHER_WORDS) assert.ok(!s.includes(w), `solo copy has no "${w}": ${s}`);
  }
  // Positive control for that check: the classroom sentences do name the teacher.
  for (const s of [lesson, safety, runtime, unknown]) assert.ok(s.includes("선생님"), s);

  // Defaults keep the copy whole when a site gives no feature or reason.
  for (const source of ["lesson", "safety", "runtime", "access", "unknown"]) {
    for (const audience of ["classroom", "solo", "neutral"]) {
      const s = DS.denialCopy({ source }, audience);
      assert.ok(!ENGLISH_IDENTIFIER.test(s), `no English identifier: ${s}`);
      assert.ok(!/undefined|null|\.\./.test(s), `no hole: ${s}`);
    }
  }
  // A next-step override replaces the default and stays one step.
  assert.equal(DS.denialCopy({ source: "runtime", reason: "도구가 준비되지 않았어요", next: "코치 혼자 이어서 해 주세요" }),
    "이 기능은 지금 앱에서 쓸 수 없어요 — 도구가 준비되지 않았어요. 코치 혼자 이어서 해 주세요.");
  ok("copy: lesson / safety / runtime / access / unknown frames, classroom / solo / neutral wording, one next step, no English identifiers");
}

// ── 3. The coach-facing tag ──
{
  for (const [source, label] of Object.entries({ lesson: "수업 설정", safety: "안전 규칙", runtime: "앱 버전/환경", access: "이용권 선택", unknown: "확인 안 됨" })) {
    assert.equal(DS.DENIAL_SOURCE_LABEL[source], label);
    const t = DS.denialToolText({ source, feature: "명령 실행" });
    assert.ok(t.startsWith(`[${label}] `), t);
    if (source !== "safety") assert.equal(t, `[${label}] ${DS.denialCopy({ source, feature: "명령 실행" })}`);
  }
  // Safety, coach-facing: no learner next step, and an explicit "no workaround" to the model.
  const safetyTool = DS.denialToolText({ source: "safety", reason: "열 수 없는 주소예요: x" }, "classroom", "(http/https만 가능)");
  assert.equal(safetyTool, `[안전 규칙] 안전을 위해 Studio가 막았어요 — 열 수 없는 주소예요: x. ${DS.SAFETY_COACH_RULE} (http/https만 가능)`, "a site's coach hint follows the copy");
  assert.match(DS.SAFETY_COACH_RULE, /우회하는 방법을 찾지 말고/);
  assert.doesNotMatch(safetyTool, /다른 방법으로|궁금하면/, "no workaround invitation in the coach text");
  // Control: the other sources' coach text carries no safety rule.
  for (const source of ["lesson", "runtime", "access", "unknown"]) assert.ok(!DS.denialToolText({ source }).includes(DS.SAFETY_COACH_RULE), source);
  for (const name of ["Bash", "PowerShell", "WebFetch", "Write", "Read", "Task", "mcp__hypeproof__consult", "mcp__hypeproof__browser_open", "SendFeedback", "TotallyNewTool"]) {
    assert.ok(!ENGLISH_IDENTIFIER.test(DS.toolFeatureName(name)), `${name} → ${DS.toolFeatureName(name)}`);
  }
  ok("tag: each source's Korean label in brackets; tool names become learner words, unknown tools → 이 도구");
}

// ── 4. The tool gate names the source of every deny branch ──
{
  const root = "/ws";
  const gate = (toolName, input = {}, extra = {}) => H.evaluateSdkToolUse({ toolName, input, permittedTools: extra.permitted ?? [], workspaceRoot: root, ...extra });
  const cases = [
    ["not granted by the profile", gate("Bash", { command: "ls" }), "lesson"],
    ["never for learners", gate("SendFeedback"), "safety"],
    ["unclassified (drift)", gate("BrandNewSdkTool"), "runtime"],
    ["path escape", gate("Read", { file_path: "/etc/passwd" }, { permitted: ["Read"] }), "safety"],
    ["url policy", gate("mcp__hypeproof__browser_open", { url: "javascript:alert(1)" }, { permitted: ["mcp__hypeproof__browser_open"] }), "safety"],
    ["subagent outside the catalog", gate("Task", { subagent_type: "general-purpose" }, { permitted: ["Task"] }), "safety"],
    ["empty shell command (malformed)", gate("Bash", { command: "  " }, { permitted: ["Bash"] }), "unknown"],
    ["minor seat: publish closed", gate("mcp__hypeproof__publish_site", {}, { minor: true }), "safety"],
    ["adult seat: publish not granted", gate("mcp__hypeproof__publish_site", {}, { minor: false }), "lesson"],
    ["adult seat: consult not bound (unknowable here)", gate("mcp__hypeproof__consult", {}, { minor: false }), "unknown"],
    ["adult seat: site_check not bound (unknowable here)", gate("mcp__hypeproof__site_check"), "unknown"],
    ["shell removed by the selected 이용권", gate("Bash", { command: "ls" }, { accessRemoved: new Set(["shell"]) }), "access"],
    ["web search removed by the selected 이용권", gate("WebFetch", { url: "https://a" }, { accessRemoved: new Set(["web_search"]) }), "access"],
    ["browser removed by the selected 이용권", gate("mcp__hypeproof__browser_open", { url: "https://a" }, { accessRemoved: new Set(["browser"]) }), "access"],
    // Negative control: the 이용권 removed something else, so this deny is still the lesson's.
    ["shell off in the profile, 이용권 removed only web search", gate("Bash", { command: "ls" }, { accessRemoved: new Set(["web_search"]) }), "lesson"],
    // The minor posture outranks the 이용권 label.
    ["minor seat, 이용권 removed browser: publish still safety", gate("mcp__hypeproof__publish_site", {}, { minor: true, accessRemoved: new Set(["browser"]) }), "safety"],
  ];
  for (const [name, v, source] of cases) {
    assert.equal(v.decision, "deny", name);
    assert.equal(v.source, source, `${name}: ${source}`);
    assert.ok(v.friendly.startsWith(`[${DS.DENIAL_SOURCE_LABEL[source]}] `), `${name}: tagged — ${v.friendly}`);
    assert.ok(!ENGLISH_IDENTIFIER.test(v.friendly), `${name}: no English identifier in the learner copy — ${v.friendly}`);
    assert.ok(v.reason.length > 0, `${name}: the host-side reason stays`);
  }
  assert.equal(gate("Bash", { command: "ls" }).drift, undefined, "a routine deny is not drift");
  assert.equal(gate("BrandNewSdkTool").drift, true, "drift is still flagged");
  // Solo seat: the lesson deny has no teacher sentence; the classroom one does.
  const solo = gate("Bash", { command: "ls" }, { audience: "solo" }).friendly;
  for (const w of TEACHER_WORDS) assert.ok(!solo.includes(w), `solo gate copy has no "${w}"`);
  assert.ok(gate("Bash", { command: "ls" }).friendly.includes("선생님께"), "classroom gate copy names the teacher (control)");
  // Allowed and asked verdicts are untouched.
  assert.deepEqual(gate("Read", { file_path: "/ws/a.html" }, { permitted: ["Read"] }), { decision: "allow" });
  assert.deepEqual(gate("Write", { file_path: "/ws/a.html" }, { permitted: ["Write"] }), { decision: "ask" });
  // The safety denies tell the coach not to work around them.
  for (const [name, v, source] of cases) if (source === "safety") assert.ok(v.friendly.includes(DS.SAFETY_COACH_RULE), name);
  ok("gate: every deny branch names its source, minor posture is safety, 이용권 removals are 이용권 선택 (negative control), consult/site_check unknown, seat wording, allow/ask unchanged");
}

// ── 4b. Web search availability by cause: the 이용권 choice vs the lesson profile ──
{
  const { accessProfile, accessRemovedFeatures } = await import("../src/accessClient.ts");
  const { turnToolsAvailability, toolsForTurn } = await import("../src/turnTools.ts");
  const choice = { id: "pass-1", label: "이용권", mode: "included", source_kind: "pass", active: true, available: true, state: "active", ends_at: 0, can_request: false,
    allowed: { models: [], efforts: [], features: ["read", "write"], runtimes: [] }, resources: [] };
  const granted = { profile_id: "p", activity_kind: "class", tools: { web_search: true }, sdk_tools: { read: true, write: true, shell: true } };
  const narrowed = accessProfile(granted, choice);
  assert.equal(narrowed.tools.web_search, false, "the 이용권 narrows web search off (accessProfile today)");
  assert.deepEqual([...accessRemovedFeatures(narrowed)].sort(), ["shell", "web_search"], "it records what it removed");
  assert.deepEqual([...accessRemovedFeatures({ ...narrowed })].sort(), ["shell", "web_search"], "a spread copy keeps the record");
  assert.ok(!JSON.stringify(narrowed).includes("web_search\":true") && !("accessRemovedFeatures" in JSON.parse(JSON.stringify(narrowed))), "JSON never carries it");
  const byAccess = turnToolsAvailability({ profile: narrowed, runtime: "agent-sdk" }).webSearch;
  assert.equal(byAccess.available, false);
  assert.equal(byAccess.reason, "지금 고른 이용권에서는 웹 검색을 쓸 수 없어요. 다른 이용권을 고르거나 이 기능 없이 이어서 해 주세요.");
  // Negative control: the same off flag set by the lesson profile itself is 수업 설정.
  const lessonOff = { ...granted, tools: { web_search: false } };
  assert.deepEqual([...accessRemovedFeatures(lessonOff)], []);
  assert.equal(turnToolsAvailability({ profile: lessonOff, runtime: "agent-sdk" }).webSearch.reason, DS.lessonFeatureOff("웹 검색"));
  // An 이용권 that removes nothing the profile had: off in the profile stays the lesson's.
  const lessonOffNarrowed = accessProfile(lessonOff, { ...choice, allowed: { ...choice.allowed, features: ["read", "write", "shell"] } });
  assert.deepEqual([...accessRemovedFeatures(lessonOffNarrowed)], []);
  assert.equal(turnToolsAvailability({ profile: lessonOffNarrowed, runtime: "agent-sdk" }).webSearch.reason, DS.lessonFeatureOff("웹 검색"));
  // Instructor / local connection: no teacher sentence.
  const instructor = turnToolsAvailability({ profile: granted, runtime: "agent-sdk", instructor: true }).webSearch.reason;
  for (const w of TEACHER_WORDS) assert.ok(!instructor.includes(w), `instructor copy has no "${w}": ${instructor}`);
  // The toolsForTurn backstop: seat-aware when told, neutral otherwise.
  const agent = { permittedTools: ["Read"], permittedMcpTools: [], permittedAgentTools: [] };
  assert.throws(() => toolsForTurn(agent, "web-search"), (e) => !TEACHER_WORDS.some((w) => e.message.includes(w)) && e.message.startsWith("지금은 웹 검색을"));
  assert.throws(() => toolsForTurn(agent, "web-search", "classroom"), (e) => e.message.includes("선생님께"));
  ok("web search: removed by the 이용권 → 이용권 선택; off in the profile → 수업 설정 (negative controls); instructor and backstop copy has no teacher words");
}

// ── 5. Source scan: no denial site still emits an old ad-hoc learner sentence ──
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoots = [path.join(here, "..", "src"), path.join(here, "..", "webview-ui", "src")];
  // Every old sentence this change replaced (the list is the inventory in REQ-STUDIO-DENIAL-SOURCE).
  const OLD = [
    "이 도구는 지금 수업에서는 사용할 수 없어요.",
    "작업 폴더 밖의 파일에는 접근할 수 없어요.",
    "\"이 주소는 열 수 없어요.\"",
    "`이 주소는 열 수 없어요: ${raw}`",
    "이 수업에서는 커리큘럼 스킬을 쓸 수 없어요.",
    "이 수업에서는 주간 리뷰를 쓸 수 없어요.",
    "이 수업에서는 프로젝트 기억을 쓸 수 없어요.",
    "이 수업에서는 실험 증거를 쓸 수 없어요.",
    "이 수업에서는 사용자 테스트 공개를 쓸 수 없어요.",
    "이 수업에서는 덱 초안을 쓸 수 없어요.",
    "이 수업에서는 ${josa(name, \"을\", \"를\")} 쓸 수 없어요.",
    "지금 수업에서는 제품 테스트를 쓸 수 없어요.",
    "지금 수업에서는 요소 고르기를 쓸 수 없어요.",
    "지금은 제품 테스트를 쓸 수 없어요.",
    "지금은 홈페이지 올리기를 쓸 수 없어요.",
    "작업 폴더 밖 경로는 쓸 수 없어요",
    "작업 폴더 밖의 파일은 사용할 수 없어요.",
    "이 수업에서 사용할 수 없는 파일 도구입니다.",
    "허용되지 않은 주소예요",
    "이 수업에서는 도우미를 쓸 수 없어요.",
    "이 수업에서는 이 도우미의 모델을 쓸 수 없어요.",
    "현재 이용권이나 활동에서 웹 검색을 사용할 수 없습니다.",
    "현재 활동에서 웹 검색을 사용할 수 없습니다.",
    "이 로컬 구독 연결은 웹 검색 선택을 아직 지원하지 않습니다.",
    "현재 실행 환경은 웹 검색 선택을 지원하지 않습니다.",
    "현재 연결에서는 웹 검색을 사용할 수 없습니다.",
    "'웹 검색을 사용할 수 없습니다.'",
  ];
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walk(p); }
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  srcRoots.forEach(walk);
  assert.ok(files.length > 100, `the scan sees the sources (${files.length} files)`);
  const scan = (text) => OLD.filter((o) => text.includes(o));
  const hits = [];
  for (const f of files) for (const o of scan(fs.readFileSync(f, "utf8"))) hits.push(`${path.relative(path.join(here, ".."), f)}: ${o}`);
  assert.deepEqual(hits, [], "no denial site emits an old ad-hoc sentence");
  // Negative control: the scan does catch each old sentence when it is present.
  for (const o of OLD) assert.deepEqual(scan(`const x = ${o};`), [o], `the scan catches ${o}`);
  // Positive control: the replacement copy is not mistaken for an old sentence.
  for (const s of [DS.lessonFeatureOff("커리큘럼 스킬"), DS.denialCopy({ source: "safety", reason: H.PATH_ESCAPE_REASON }), DS.denialCopy({ source: "unknown", feature: "웹 검색" })]) {
    assert.deepEqual(scan(s), [], s);
  }
  ok(`source scan: ${OLD.length} old sentences absent from ${files.length} files (negative and positive controls)`);
}

console.log(`\ndenial-source.smoke.mjs — ${passed} checks passed`);
