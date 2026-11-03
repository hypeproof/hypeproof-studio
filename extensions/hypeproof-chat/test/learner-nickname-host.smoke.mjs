// CGP-KNOW-R-032 (REQ-STUDIO-LEARNER-NICKNAME, REQ-KNOW-50) — the learner nickname on the real
// ChatPanelProvider. Bundled with esbuild; VS Code I/O, the activity connection and the model runtime
// are scripted. The scripted proxy records every request the host makes: a turn's `userText` is exactly
// what the model receives. Checked here:
//   - a saved nickname appears in the next request (and every one after, retries included), model-only;
//   - a change applies to the next request; clearing removes it;
//   - the host refuses phone, resident-number, address, over-long and odd-character values (nothing stored);
//   - classroom, lesson, unknown and instructor seats neither store nor send one, even if a value is stored;
//   - a stored value that fails today's screen, or another activity's value, is never sent.
// No network, CLI, model call or VS Code window.
// Run: node --experimental-strip-types test/learner-nickname-host.smoke.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { screenNickname, nicknameContext, nicknameSeat, NICKNAME_COPY } from "../src/learnerNickname.ts";

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL("..", import.meta.url));
const copy = (v) => JSON.parse(JSON.stringify(v));
let passed = 0;
const failures = [];

const bundle = await build({
  stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export { FOLDER_CONSENT_KEY } from './src/folderConsent'; export { setHostWriteSink } from './src/artifactProvenance';", resolveDir: extension, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
  plugins: [{ name: "scripted-runtime", setup(b) {
    const swap = { "./proxyClient": "proxy", "./activityConnections": "connections" };
    b.onResolve({ filter: /^\.\/(proxyClient|activityConnections)$/ }, (args) => args.importer.endsWith("/chatPanelProvider.ts") ? { path: swap[args.path], namespace: "runtime" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "runtime" }, (args) => ({ loader: "ts", resolveDir: extension, contents: args.path === "proxy"
      ? `export * from ${JSON.stringify(path.join(extension, "src/proxyClient.ts"))}; export const proxyChat=(a)=>globalThis.runtime.proxy(a); export const verifyActivity=async()=>{};`
      : `export * from ${JSON.stringify(path.join(extension, "src/activityConnections.ts"))}; export const activityConnections=()=>globalThis.runtime.connections;` }));
  } }],
});

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-nickname-host-")));
const storage = path.join(tmp, "storage");
const outside = path.join(tmp, "picked");
fs.mkdirSync(storage); fs.mkdirSync(outside);
const put = (dir, rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };

const CARD = { object_id: "obj-12345678", kind: "material", title: "자료", body: "본문", links: [], revision: 1, received_at: 1, is_new: false, withdrawn: false, unreadable: false };

function fixture({ profile, instructor = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, "work-"));
  const posts = [], history = [], proxyCalls = []; let configPosts = 0;
  let pick = null, onPick = null;
  const watchers = [];
  const connections = { scope: "a1", current: { service: "http://127.0.0.1:1/v1", serverId: "srv" }, token: async () => "synthetic-token", acquire: () => () => {} };
  const runtime = { connections, proxy: async (a) => { proxyCalls.push(copy({ userText: a.userText, history: a.history })); a.onDelta?.("네"); return { text: "네", toolUses: [] }; } };
  const vscode = {
    env: { appName: "HypeProof Studio" },
    workspace: { createFileSystemWatcher: (pattern) => { const w = { pattern, on: {}, disposed: false, dispose() { this.disposed = true; } }; for (const k of ["Create", "Delete", "Change"]) w[`onDid${k}`] = (fn) => { w.on[k] = fn; return { dispose() {} }; }; watchers.push(w); return w; },
      workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (k, f) => ({ coachRuntime: "proxy", proxyUrl: "http://127.0.0.1:1/v1" })[k] ?? f }) },
    window: { createOutputChannel: () => ({ appendLine() {} }), showOpenDialog: async () => { await onPick?.(); return pick ? [{ fsPath: pick }] : undefined; }, showWarningMessage: async () => undefined, showInformationMessage: async () => undefined },
    commands: { executeCommand: async () => undefined },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    Uri: { file: (fsPath) => ({ fsPath }), joinPath: (u, ...n) => ({ fsPath: path.join(u.fsPath, ...n) }) },
    ProgressLocation: { Window: 10 },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, runtime, console, process: { ...process, env: { PATH: process.env.PATH } },
    require: (id) => id === "vscode" ? vscode : require(id),
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, performance,
    fetch: async () => { throw new Error("Network is forbidden in this test"); },
  });
  const { ChatPanelProvider, FOLDER_CONSENT_KEY, setHostWriteSink } = module.exports;
  const hostWrites = [];
  setHostWriteSink({ wrote: (writes, actor) => hostWrites.push({ paths: writes.map((w) => w.absPath), actor }), replaced() {} });
  const h = Object.create(ChatPanelProvider.prototype), state = new Map(), global = new Map();
  const seat = profile ?? { profile_id: "class-a", activity_kind: "classroom", activity_id: "act-1", sdk_tools: { read: true }, ux: { coach: { naming_mode: "fixed", fallback_name: "코치" } } };
  let task = "task-a";
  Object.assign(h, {
    context: { globalStorageUri: { fsPath: storage }, workspaceState: { get: (k, f) => state.get(k) ?? f, update: async (k, v) => state.set(k, v) }, globalState: { get: (k) => global.get(k), update: async (k, v) => global.set(k, v) }, secrets: { get: async () => "synthetic-token" }, subscriptions: [] },
    nativeHistoryScope: "task-a", pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: instructor, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: seat, accessState: null, servedWorkspaceRoot: null,
    getHistory: () => history, appendHistory: async (items) => { for (const it of items) history.push(copy(it)); },
    post: async (e) => { posts.push(copy(e)); }, postConfig: async () => { configPosts++; }, getCoach: () => ({ name: "코치", personality: "", configured: true }),
    ensureProfile: async () => seat, loadAccess: async () => {},
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: "" }), commitAttachedImages: () => "",
    resolveCoachCwd: () => root, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
    provenanceRecorder: () => null, turnRequestScope: () => JSON.stringify(["a1", task]),
    inboxSource: { inboxView: async () => ({ run: "r", student: "s", generation: 1, ended: false, offline: false, cards: [CARD, { ...CARD, object_id: "obj-withdrawn", withdrawn: true }], unread: 0 }), inboxOpened: async () => {}, inboxLink: async () => null },
  });
  const states = () => posts.filter((e) => e.type === "materialsState");
  const last = () => states().at(-1);
  let n = 0;
  const say = async (msg) => { await h.handleMessage({ activityId: "a1", ...msg }); return last(); };
  const req = (type, extra = {}) => say({ type, requestId: `r${++n}`, ...extra });
  const send = (text, id) => h.handleMessage({ type: "sendMessage", activityId: "a1", text, history: [], toolMode: "auto", userMessageId: id });
  // A personal seat asks which AI permission this folder gets before the first send; the read grant is enough here.
  global.set(FOLDER_CONSENT_KEY, { "act-1": { [root]: { level: "read", at: 1 } } });
  return { h, seat, connections, posts, history, proxyCalls, say, send, global, configPosts: () => configPosts };
}

const t = async (label, fn) => { try { await fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.stack ?? e}`); } };
const KEY = "hps.learnerNickname:a1";
const LINE = "[Studio 안내: 학습자가 대화 설정에서 정한 호칭은";
const coach = { naming_mode: "fixed", fallback_name: "코치" };
const PERSONAL = { profile_id: "solo", activity_kind: "personal", activity_id: "act-1", ux: { coach } };
const TRIAL = { ...PERSONAL, profile_id: "trial", activity_kind: "trial" };
const CLASSROOM = { profile_id: "class-a", activity_kind: "classroom", activity_id: "act-1", ux: { coach } };
const LESSON = { ...PERSONAL, lesson: { sha256: "abc", content: { steps: [] } } };
const UNKNOWN = { profile_id: "x", activity_id: "act-1", ux: { coach } };
const setNick = (f, nickname) => f.say({ type: "setLearnerNickname", nickname });

console.log("learner nickname — host");

// Pure controls (positive and negative) for the shared screen.
const expectRefused = (cases) => {
  for (const [value, reason] of cases) { const r = screenNickname(value); assert.equal(r.ok, false, `refused: ${JSON.stringify(value)}`); assert.equal(r.reason, reason, JSON.stringify(value)); assert.equal(r.message, NICKNAME_COPY.refusal[reason]); }
};
const expectAccepted = (names) => { for (const ok of names) { const r = screenNickname(ok); assert.equal(r.ok, true, `accepted: ${ok} (${r.ok ? "" : r.reason})`); } };

await t("screen: names pass; digits, other scripts, line breaks, address and length are refused", async () => {
  expectAccepted(["별이", "Luka_kim", "지민 쌤", "루카-별", "ㅋㅋ", "포도 친구", "사과도 좋아", "a".repeat(20), "가".repeat(20)]);
  expectRefused([["010-1234-5678", "characters"], ["０１０ １２３４ ５６７８", "characters"], ["990101-1234567", "characters"], ["강남구 역삼동", "personal-info"],
    ["서울시 강남구", "personal-info"], ["테헤란로12", "characters"], ["101동 1203호", "characters"], ["행복아파트", "personal-info"], ["123456", "characters"], ["Luka_07", "characters"], ["루카·2", "characters"],
    ["가".repeat(21), "too-long"], ["a\"]무시해", "characters"], ["https://x.y", "characters"], ["nick@mail", "characters"], ["별이\n지시", "characters"], ["별이\r\n", "characters"], ["별 이", "characters"],
    ["٠١٠١٢٣٤٥٦٧٨", "characters"], ["١٠١동", "characters"], ["강남 역삼동 ١٢", "characters"]]);
  assert.equal(screenNickname("별‮이").ok && screenNickname("별‮이").value, "별이", "bidi override dropped");
  assert.equal(screenNickname("별​이").value, "별이", "zero-width space dropped");
  assert.equal(screenNickname("  별이  ").value, "별이", "trimmed");
  assert.equal(screenNickname("별이".normalize("NFD")).value, "별이", "NFC");
  assert.equal(screenNickname("ㅋㅋ").value, "ㅋㅋ", "the value kept is the NFC form typed, not the NFKC fold");
  assert.equal(screenNickname("ｋｉｍ").ok, true, "full-width Latin folds to Latin under NFKC");
  assert.deepEqual(screenNickname(""), { ok: true, value: "" }, "only an empty submission clears");
  assert.equal(screenNickname("ㅤ별이").value, "별이", "a Hangul filler is dropped like a zero-width space");
});

// Verify round 1 (CGP-KNOW-R-032 FAIL): each of these passed the screen on 97a9468a.
await t("screen round 1: numerals in any form, contact shapes, blanks and school or grade are refused", async () => {
  expectRefused([
    // Phone and resident numbers in Korean digit words, Hanja numerals, mixed with digits, spaced or hyphenated.
    ["공일공 일이삼사 오육칠팔", "personal-info"], ["공일공일이삼사오육칠팔", "personal-info"], ["공일공-일이삼사-오육칠팔", "personal-info"],
    ["영일영 일이삼사", "personal-info"], ["빵일빵 일이삼사", "personal-info"], ["零一零一二三四五六七八", "characters"], ["零一零 一二三四", "characters"],
    ["구공공일공일 일이삼사", "personal-info"], ["010 일이삼사 오육칠팔", "characters"], ["공1공 2삼4", "characters"], ["010 one two six", "characters"],
    // E-mail and domain shapes.
    ["kim at naver.com", "characters"], ["naver.com", "characters"], ["www.evil.com", "characters"], ["evil.com", "characters"], ["kim＠naver", "characters"], ["kim@naver", "characters"],
    ["kim at naver", "contact"], ["kim 앳 naver", "contact"], ["김 골뱅이 네이버", "contact"], ["naver dot com", "contact"], ["naver com", "contact"], ["naver·com", "characters"],
    ["www evil", "contact"], ["https evil", "contact"], ["네이버닷컴", "contact"],
    // Invisible or blank: Hangul fillers, zero-width, whitespace only, separators only.
    ["ㅤㅤ", "blank"], ["ᅟᅠ", "blank"], ["ﾠ", "blank"], ["​​", "blank"], ["   ", "blank"], ["ㅤ 　", "blank"], ["_-", "blank"],
    // Owner decision 2026-10-25: school and grade or class identifiers.
    ["하늘초등학교 3학년", "characters"], ["하늘초등학교", "school"], ["별빛중학교 친구", "school"], ["한빛고등학교", "school"], ["우리 학교", "school"],
    ["3학년 2반", "characters"], ["삼학년 이반", "school"], ["육학년", "school"], ["三학년", "characters"], ["학년 3", "characters"], ["grade 3", "characters"], ["3rd grade", "characters"],
  ]);
  expectAccepted(["구름이", "이슬비", "영희", "오이", "이수일", "일등 사자", "사랑이 오빠", "Call me Jay", "Love me", "Star-Lord", "Mina", "고학년 친구", "학년이 좋아", "Kim Kat"]);
});

// Verify round 2 (re-verify FAIL on 5cc7571f) and the owner's structural rule (2026-10-25): each passed on 5cc7571f.
await t("screen round 2: allowlist of scripts, glued contact markers, numeral-word addresses, school abbreviations", async () => {
  expectRefused([
    // Homoglyphs and other scripts: only Hangul and Latin A-Z are allowed.
    ["kim аt naver", "characters"], ["kim at nаver", "characters"], ["naver cоm", "characters"], ["kim nаver cоm", "characters"], ["ԝԝԝ evil", "characters"],
    ["kim ɑt naver", "characters"], ["kim αt naver", "characters"], ["рор аt gmail", "characters"], ["Ⅻ", "characters"], ["ⅰⅱⅲ", "characters"], ["①②", "characters"], ["별²", "characters"], ["가🐱", "characters"],
    ["kim ａｔ naver", "contact"], ["naver ｃｏｍ", "contact"],
    // Contact markers glued or misspelled.
    ["kim앳naver닷com", "contact"], ["kim앳naver", "contact"], ["kim엣naver", "contact"], ["kim 엣 naver", "contact"], ["kim 골벵이 naver", "contact"], ["kim골뱅이naver", "contact"],
    ["kimatnaver", "contact"], ["kimatnaverdotcom", "contact"], ["naver닷com", "contact"], ["naver 닷 컴", "contact"], ["kim 앳 네이버", "contact"], ["김앳네이버", "contact"],
    ["김 앳 네이버 닷 컴", "contact"], ["네이버 점 컴", "contact"], ["네이버점컴", "contact"], ["naver쩜kr", "contact"], ["at naver", "contact"], ["navercom", "contact"],
    // Addresses with numeral words.
    ["역삼동 일이삼", "personal-info"], ["역삼동 백이십삼", "personal-info"], ["테헤란로 십이길", "personal-info"], ["일공일동 일이공삼호", "personal-info"], ["백일동 천이백삼호", "personal-info"],
    ["삼일로 별이", "personal-info"], ["별빛동 이삼", "personal-info"],
    // Numerals spelled out: positional 십 and native Korean counting.
    ["십이 삼십사 오십육", "personal-info"], ["하나둘셋넷다섯여섯", "personal-info"], ["공_일_공_일_이_삼", "personal-info"],
    // School abbreviations with a grade or class in numeral words; English ordinals.
    ["하늘초 삼학년 이반", "school"], ["별빛중 이-삼", "school"], ["하늘초 삼 이", "school"], ["한빛고 일반", "school"], ["third grade", "school"], ["grade three", "school"],
    // Digits of any script, even below six.
    ["하늘초 3학년", "characters"], ["별빛중 2-3", "characters"], ["OlO l2E4 S678", "characters"], ["o-1-o-1-2-3", "characters"], ["a1b2c3d4e5", "characters"], ["별이2", "characters"],
  ]);
  // Positive controls from the re-verify, and words next to the new markers.
  expectAccepted(["오이 구이", "사오리 이수아", "구일이 영식이", "일이 많은 사람", "이삼사오", "오일 칠이", "Number one", "nine lives", "Jay dot", "mr dot",
    "별점 친구", "별 점 친구", "점심 친구", "앳된 별이", "엣지 소녀", "골목길이", "동동이", "하늘초", "강남 역삼동", "a b c d e f g h i j", "ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ ㅊ", "Dot Cooper", "kim at"]);
  assert.equal(nicknameContext("ㅤㅤ"), null, "a stored blank-looking value is not sent");
  assert.equal(nicknameContext("공일공 일이삼사 오육칠팔"), null, "a stored digit-word phone number is not sent");
  assert.equal(nicknameContext("kim앳naver"), null, "a stored glued contact is not sent");
  assert.equal(nicknameContext("010 1234 5678"), null, "a stored value that fails the screen is not sent");
  assert.equal(nicknameContext(42), null);
  assert.ok(nicknameContext("별이").includes('"별이"'));
  for (const [seat, instructor, want] of [[PERSONAL, false, true], [TRIAL, false, true], [CLASSROOM, false, false], [LESSON, false, false], [UNKNOWN, false, false], [PERSONAL, true, false], [null, false, false]])
    assert.equal(nicknameSeat(seat, instructor), want, JSON.stringify([seat?.profile_id, seat?.lesson ? "lesson" : "", instructor]));
});

// Verify round 3 (re-verify FAIL on f33329c8): messenger and social handles, mail host + 메일, school demonyms.
await t("screen round 3: platform words, mail host + 메일 and school demonyms are refused", async () => {
  expectRefused([
    ["카톡 kimjay", "contact"], ["지민 ig kimjay", "contact"], ["tg kimjay", "contact"], ["인별 kimjay", "contact"], ["카톡아이디 kimjay", "contact"], ["카카오톡 kimjay", "contact"], ["kakao kimjay", "contact"], ["카톡 별이공주", "contact"],
    ["인스타 kimjay", "contact"], ["insta kim_jay", "contact"], ["instagram kimjay", "contact"], ["디코 kimjay", "contact"], ["discord kimjay", "contact"], ["디스코드 별이", "contact"],
    ["유튜브 별이tv", "contact"], ["youtube kimjay", "contact"], ["yt kimjay", "contact"], ["틱톡 kimjay", "contact"], ["tiktok kimjay", "contact"],
    ["페북 kimjay", "contact"], ["facebook kimjay", "contact"], ["fb kimjay", "contact"], ["트위터 kimjay", "contact"], ["twitter kimjay", "contact"],
    ["텔레 kimjay", "contact"], ["telegram kimjay", "contact"], ["라인 kimjay", "contact"], ["line kimjay", "contact"], ["메일 kimjay", "contact"], ["mail kimjay", "contact"],
    ["gmail kimjay", "contact"], ["kimjaygmail", "contact"], ["아이디 kimjay", "contact"], ["id kimjay", "contact"], ["번호 별이", "contact"], ["폰 별이", "contact"], ["휴대폰 kim", "contact"],
    ["kimjay 네이버 메일", "contact"], ["kimjay naver mail", "contact"], ["kimjay 한메일", "contact"], ["kimjay 네이버메일", "contact"],
    ["하늘초등학생 별이", "school"], ["하늘중학생", "school"], ["별빛고등학생", "school"], ["하늘초등 별이", "school"], ["초딩 별이", "school"], ["중딩 별이", "school"], ["고딩 별이", "school"],
    ["초등학생", "school"], ["하늘중 학생", "school"],
  ]);
  // Positive controls: ordinary words next to the new markers, and grade shorthands the owner leaves allowed.
  expectAccepted(["Lined", "Idol 별이", "아이디어 왕", "카레", "Liner", "Mailey", "Kim Fbi", "인디 소녀", "고삼 별이", "하늘초", "초코 별이", "하준", "서연", "삼순이", "백호", "천사"]);
  assert.equal(nicknameContext("카톡 kimjay"), null, "a stored platform handle is not sent");
});

await t("a saved nickname appears in the next request, model-only; every request after it carries it", async () => {
  const f = fixture({ profile: PERSONAL });
  await f.send("안녕", "u-0");
  assert.ok(!f.proxyCalls[0].userText.includes(LINE), "negative control: no nickname before one is saved");
  await setNick(f, "별이");
  assert.equal(f.global.get(KEY), "별이", "stored per activity");
  assert.equal(f.h.storedLearnerNickname(), "별이", "config value");
  assert.ok(f.configPosts() >= 1, "the panel is told");
  await f.send("표지 어떻게 해?", "u-1");
  const sent = f.proxyCalls[1].userText;
  assert.ok(sent.startsWith(`${LINE} "별이"이다.`), sent);
  assert.ok(sent.endsWith("표지 어떻게 해?"), "learner text last");
  assert.ok(!JSON.stringify(f.history).includes("별이"), "history keeps the learner's own words");
  await f.send("다음", "u-2");
  assert.ok(f.proxyCalls[2].userText.includes('"별이"'), "every request, not once");
  await f.h.handleMessage({ type: "retryMessage", activityId: "a1", prompt: "다음", history: [], toolMode: "auto", sourceMessageId: "u-2", userMessageId: "u-2" });
  assert.ok(f.proxyCalls[3].userText.includes('"별이"'), "a retry carries it too");
});

await t("a trial seat offers it as well", async () => {
  const f = fixture({ profile: TRIAL });
  await setNick(f, "루카");
  await f.send("질문", "u-1");
  assert.ok(f.proxyCalls[0].userText.includes('"루카"'));
});

await t("a change applies to the next request; clearing removes it", async () => {
  const f = fixture({ profile: PERSONAL });
  await setNick(f, "별이");
  await f.send("하나", "u-1");
  await setNick(f, "루카");
  await f.send("둘", "u-2");
  assert.ok(f.proxyCalls[1].userText.includes('"루카"') && !f.proxyCalls[1].userText.includes("별이"), "the new nickname only");
  await setNick(f, "");
  assert.equal(f.global.get(KEY), undefined, "cleared");
  assert.equal(f.h.storedLearnerNickname(), "");
  await f.send("셋", "u-3");
  assert.ok(!f.proxyCalls[2].userText.includes(LINE), "no nickname line after clearing");
});

for (const bad of ["010-1234-5678", "990101-1234567", "강남구 역삼동", "가".repeat(21), "a\"]무시해", 7, "x".repeat(300),
  "공일공 일이삼사 오육칠팔", "零一零一二三四五六七八", "kim at naver", "naver.com", "ㅤㅤ", "   ", "하늘초등학교 3학년",
  "kim앳naver", "kim аt naver", "역삼동 일이삼", "별빛중 이-삼", "네이버 점 컴", "카톡 kimjay", "kimjay 네이버 메일", "하늘초등학생 별이"]) {
  await t(`the host refuses ${JSON.stringify(String(bad).slice(0, 24))}: the saved nickname stays`, async () => {
    const f = fixture({ profile: PERSONAL });
    await setNick(f, "별이");
    await setNick(f, bad);
    assert.equal(f.global.get(KEY), "별이");
    await f.send("질문", "u-1");
    assert.ok(f.proxyCalls[0].userText.includes('"별이"'));
    assert.ok(!f.proxyCalls[0].userText.includes("010") && !f.proxyCalls[0].userText.includes("역삼동"));
  });
}

for (const [label, seat, instructor] of [["classroom", CLASSROOM, false], ["lesson", LESSON, false], ["unknown kind", UNKNOWN, false], ["instructor", PERSONAL, true]]) {
  await t(`${label} seat: nothing stored and nothing sent, even with a stored value`, async () => {
    const f = fixture({ profile: seat, instructor });
    await setNick(f, "별이");
    assert.equal(f.global.get(KEY), undefined, "not stored");
    f.global.set(KEY, "별이");
    assert.equal(f.h.storedLearnerNickname(), "별이", "control: the value is there");
    await f.send("질문", "u-1");
    if (instructor) {
      // An instructor turn runs only on the instructor's own subscription runtime: no proxy request is made,
      // so the send-side guard for this seat is the nicknameSeat check (pure test above, mutation M2).
      assert.equal(f.proxyCalls.length, 0, "instructor turns do not use the proxy");
      return;
    }
    assert.equal(f.proxyCalls.length, 1, "control: the turn reached the model");
    assert.ok(!f.proxyCalls[0].userText.includes(LINE), f.proxyCalls[0].userText);
  });
}

await t("a stored value that fails the screen is not sent, and the field shows it empty", async () => {
  const f = fixture({ profile: PERSONAL });
  f.global.set(KEY, "010 1234 5678");
  assert.equal(f.h.storedLearnerNickname(), "");
  await f.send("질문", "u-1");
  assert.ok(!f.proxyCalls[0].userText.includes(LINE));
  assert.ok(!f.proxyCalls[0].userText.includes("1234"));
});

await t("an activity switch during the save drops it: nothing is stored under either activity", async () => {
  const f = fixture({ profile: PERSONAL });
  const read = f.h.ensureProfile;
  f.h.ensureProfile = async () => { f.connections.scope = "b2"; return read(); };
  await setNick(f, "별이");
  assert.equal(f.global.get(KEY), undefined, "not under the activity it came from");
  assert.equal(f.global.get("hps.learnerNickname:b2"), undefined, "not under the activity switched to");
  f.connections.scope = "a1"; f.h.ensureProfile = read;
  await setNick(f, "별이");
  assert.equal(f.global.get(KEY), "별이", "control: without a switch it is stored");
});

await t("another activity's nickname is never sent", async () => {
  const f = fixture({ profile: PERSONAL });
  f.global.set("hps.learnerNickname:b9", "별이");
  f.global.set("hps.learnerNickname", "루카");
  await f.send("질문", "u-1");
  assert.ok(!f.proxyCalls[0].userText.includes(LINE));
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) { console.error(`learner-nickname-host: ${failures.length} failed`); process.exit(1); }
console.log(`learner-nickname-host smoke OK (${passed})`);
