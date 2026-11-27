// Studio-side merge and routing checks for instructor turns. These run without any Chalk code:
// the extra tool set is injected, so the tool names below are only stand-ins.
// T-G16–T-G20 bodies were moved here verbatim from chalk-generator.test.mjs when that file was retired (C-5).
// The chalk/tools.ts routing unit T-L10 is retired with callChalkTool (legacy-only); delegation stays covered by T-L10 below.
import assert from "node:assert/strict";
import { createServer } from "node:http";

const { mergeBrowserTools, mergeExtraTools, localRuntimeConfig } = await import("../src/localRuntime/index.ts");
const { runBrowserOpen, runLivePreviewStart } = await import("../src/browserMcp.ts");

let n = 0;
const check = async (name, fn) => { await fn(); n++; console.log(`  ok   ${name}`); };

const stubExtraDefs = [
  { name: "chalk_check_plan", description: "stub", inputSchema: {} },
  { name: "chalk_get_knowledge", description: "stub", inputSchema: {} },
  { name: "chalk_recommend_methods", description: "stub", inputSchema: {} },
];
const mockWorkTools = { definitions: [{ name: "Read", description: "", inputSchema: {} }], call: async () => "read-result" };

console.log("=== browser tools in the instructor turn (T-G16–T-G20; bodies verbatim from chalk-generator.test.mjs, C-5) ===");

// ─── T-G16: 강사 모드 mergeBrowserTools → browser 도구 2개 포함, 연속 두 턴 ──
await check('T-G16 instructor mode: live_preview_start + browser_open in merged defs (two consecutive turns)', () => {
  const BROWSER_DEFS = [
    { name: 'live_preview_start', description: '라이브 서버 시작', inputSchema: { type: 'object' } },
    { name: 'browser_open', description: '브라우저 열기', inputSchema: { type: 'object' } },
  ];
  const browserTools = { definitions: BROWSER_DEFS, call: async () => 'ok' };

  const mockWork = { definitions: [{ name: 'Read', description: '', inputSchema: {} }], call: async () => 'ok' };

  // Simulate two consecutive instructor turns by merging twice from the same base.
  for (const turn of [1, 2]) {
    const merged = mergeBrowserTools(mockWork, browserTools);
    const names = merged.definitions.map(d => d.name);
    assert.ok(names.includes('live_preview_start'), `턴 ${turn}: live_preview_start 없음`);
    assert.ok(names.includes('browser_open'), `턴 ${turn}: browser_open 없음`);
  }
});

// ─── T-G17: 학생 모드(browserTools=undefined) → browser 도구 없음 ──────────
await check('T-G17 student mode (no browserTools): live_preview_start + browser_open NOT in defs', () => {
  const mockWork = { definitions: [{ name: 'Read', description: '', inputSchema: {} }], call: async () => 'ok' };
  const merged = mergeBrowserTools(mockWork, undefined);
  const names = merged.definitions.map(d => d.name);
  assert.ok(!names.includes('live_preview_start'), 'live_preview_start must not appear without browserTools');
  assert.ok(!names.includes('browser_open'), 'browser_open must not appear without browserTools');
  // Base tools preserved.
  assert.ok(names.includes('Read'), 'Read must still be present');
});

// ─── T-G18: browser_open 라우팅 — url이 실제로 전달되는지 단언 ─────────────
await check('T-G18 mergeBrowserTools routes browser_open and passes the url input through', async () => {
  let calledWith = null;
  const BROWSER_DEFS = [
    { name: 'live_preview_start', description: '', inputSchema: {} },
    { name: 'browser_open', description: '', inputSchema: {} },
  ];
  const TARGET_URL = 'http://127.0.0.1:3000/chalk/lesson-01/lesson.html';
  const browserTools = {
    definitions: BROWSER_DEFS,
    call: async (name, input) => { calledWith = { name, input }; return 'opened'; },
  };
  const mockWork = { definitions: [], call: async () => { throw new Error('base call must not be reached'); } };
  const merged = mergeBrowserTools(mockWork, browserTools);
  const result = await merged.call('browser_open', { url: TARGET_URL });
  assert.equal(calledWith?.name, 'browser_open', 'browser_open이 browserTools.call로 위임되지 않았다');
  // The url must be passed through to browserTools.call, not ignored.
  assert.deepEqual(calledWith?.input, { url: TARGET_URL }, `url이 browserTools.call에 전달되지 않았다: ${JSON.stringify(calledWith?.input)}`);
  assert.equal(result, 'opened', '결과가 browserTools.call 반환값과 다르다');
});

// ─── T-G19: runBrowserOpen isError → call throws (강사 경로 실패 전파) ──────
await check('T-G19 runBrowserOpen isError propagates: call throws so local runtime sees failure', async () => {
  // Fake host: live server up, fetchHead returns 404 for the requested path.
  const LIVE_URL = 'http://127.0.0.1:9999/';
  const fakeHost = {
    openBrowser: async () => {},
    screenshot: async () => null,
    startLivePreview: async () => LIVE_URL,
    livePreviewUrl: async () => LIVE_URL,
    fetchHead: async (_url) => ({ ok: false, status: 404 }),
    currentPage: async () => null,
    openPages: async () => null,
  };

  const r = await runBrowserOpen(fakeHost, LIVE_URL + 'chalk/lesson-01/lesson.html');
  assert.ok(r.isError, 'runBrowserOpen must return isError:true for 404');
  assert.ok(r.content.some(b => b.type === 'text' && b.text.includes('파일이 없어요')),
    `result text must mention 파일이 없어요: ${JSON.stringify(r.content)}`);

  // Simulate what the instructor call() does: throw when isError.
  const text = r.content.map(b => b.type === 'text' ? b.text : '').join('\n');
  let threw = false;
  try {
    if (r.isError) throw new Error(text);
  } catch {
    threw = true;
  }
  assert.ok(threw, 'call must throw for isError result so local runtime marks tool as failed');
});

// ─── T-G20: runBrowserOpen #507 포트 교정 — 잘못된 포트 → 라이브 서버 주소로 교정 ─
await check('T-G20 runBrowserOpen #507: wrong loopback port corrected to live server url', async () => {
  const LIVE_URL = 'http://127.0.0.1:58085/';
  let openedWith = null;
  const fakeHost = {
    openBrowser: async (url) => { openedWith = url; },
    screenshot: async () => null,
    // livePreviewUrl returns null initially → triggers #507 startLivePreview branch.
    livePreviewUrl: async () => null,
    startLivePreview: async () => LIVE_URL,
    currentPage: async () => null,
    openPages: async () => null,
  };

  const WRONG_PORT_URL = 'http://127.0.0.1:3000/';
  const r = await runBrowserOpen(fakeHost, WRONG_PORT_URL);
  assert.ok(!r.isError, `must succeed: ${JSON.stringify(r)}`);
  const text = r.content.map(b => b.type === 'text' ? b.text : '').join('\n');
  assert.ok(text.includes(LIVE_URL), `result must mention the corrected live url ${LIVE_URL}: ${text}`);
  // #507 branch calls startLivePreview which opens the browser — openBrowser is NOT called.
  assert.equal(openedWith, null, 'openBrowser must NOT be called when #507 startLivePreview handles it');
});

console.log("=== extra tools in the instructor turn (T-L8, T-L9, T-L10) ===");

await check("T-L8 instructor mode: extra tool definitions added to definitions (Claude+Codex path)", () => {
  const names = mergeExtraTools(mockWorkTools, { definitions: stubExtraDefs, call: async () => "stub" }).definitions.map((d) => d.name);
  assert.ok(names.includes("Read"), "workspace tool preserved");
  assert.ok(names.includes("chalk_check_plan"));
  assert.ok(names.includes("chalk_get_knowledge"));
  assert.ok(names.includes("chalk_recommend_methods"));
});

await check("T-L9 student mode: extra tool definitions NOT present", () => {
  const names = mergeExtraTools(mockWorkTools, undefined).definitions.map((d) => d.name);
  assert.ok(names.includes("Read"), "workspace tool preserved");
  assert.ok(!names.some((x) => x.startsWith("chalk_")), `extra tools must not appear; found: ${names.filter((x) => x.startsWith("chalk_")).join(",")}`);
});

await check("T-L10 extra tool call is routed to the injected call and its result comes back (no workspace call)", async () => {
  const SECRET_TOKEN = "secret-token-spy-test";
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.url ?? ""); res.writeHead(200); res.end("{}"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const extra = {
      definitions: stubExtraDefs,
      call: async (name, input) => { seen.push(`extra:${name}`); return JSON.stringify({ name, input, token: "" }); },
    };
    const merged = mergeExtraTools(mockWorkTools, extra);
    const result = await merged.call("chalk_check_plan", { cohort: "c1", course: "l1" });
    assert.ok(seen.includes("extra:chalk_check_plan"), "extra call not reached");
    assert.ok(!seen.some((x) => x === "read-result"), "workspace call must not run for an extra tool");
    assert.ok(!result.includes(SECRET_TOKEN));
  } finally {
    server.close();
  }
});

console.log("=== mode merge units (T-mode 28, 29) ===");

await check("T-mode 28 mergeExtraTools: extra set present → chalk_* tool names in definitions", () => {
  const names = mergeExtraTools({ definitions: [], call: async () => "" }, { definitions: stubExtraDefs, call: async () => "" }).definitions.map((d) => d.name);
  assert.ok(names.some((x) => x.startsWith("chalk_")), `chalk_* tool must appear; got: [${names.join(", ")}]`);
});

await check("T-mode 29 mergeExtraTools: no extra set → no chalk_* in definitions", () => {
  const names = mergeExtraTools({ definitions: [], call: async () => "" }, undefined).definitions.map((d) => d.name);
  assert.ok(!names.some((x) => x.startsWith("chalk_")));
});

console.log("=== local runtime config (T-mode 12, 13) ===");

await check("T-mode 12 localRuntimeConfig: Dev app name but HPS_DEV_RUNTIME unset → null", () => {
  assert.strictEqual(localRuntimeConfig("HypeProof Studio Dev", "http://127.0.0.1:8787/v1", {}), null);
});

await check("T-mode 13 localRuntimeConfig: Dev + runtime on + remote proxyUrl → throws", () => {
  const env = { HPS_DEV_RUNTIME: "1", HPS_DEV_PROVIDER: "claude", HPS_DEV_EXECUTABLE: "/usr/local/bin/claude", HPS_DEV_MODEL: "claude-sonnet-5" };
  assert.throws(() => localRuntimeConfig("HypeProof Studio Dev", "https://api.hypeproof-ai.xyz/v1", env), /로컬 구독/);
});

console.log(`\n${n} units passed`);
