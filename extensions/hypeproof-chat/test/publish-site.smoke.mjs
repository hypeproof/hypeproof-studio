// One-click publish (src/publish/) — the pipeline against a scripted GitHub, and its pure parts.
//
// What is locked here, each with a control that must pass and one that must fail:
//   - the gate, the slug and domain rules, scope parsing;
//   - preflight: block what works in the preview but breaks/leaks on Pages, warn about the rest;
//   - the publish ORDER the July class proved (Pages on `workflow` and read back BEFORE the
//     workflow file lands — the mock fails the run otherwise, as configure-pages did in #500);
//   - one atomic snapshot commit; unchanged blobs are not re-uploaded;
//   - R0: `verified`/`url` only after the live host served this run's nonce;
//   - the save stage (D-017): files only, no workflow, no Pages call;
//   - failures: name taken, missing workflow scope, Pages never ready, Actions failure,
//     nonce never visible, rate limits, gh missing; the custom-domain state machine.
//
// Run: node --experimental-strip-types test/publish-site.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { createMockGitHub } from "./fixtures/mock-github.mjs";

const C = await import("../src/publish/publishContract.ts");
const { parseOAuthScopes, missingScopes, createGitHubApi, createFetchTransport } = await import("../src/publish/githubApi.ts");
const { preflightSite } = await import("../src/publish/sitePreflight.ts");
const { runPublishSite, siteUrlFor } = await import("../src/publish/publishSite.ts");
const { dnsRecordsFor, splitDomain } = await import("../src/publish/customDomain.ts");
const { PAGES_WORKFLOW_YAML, gitBlobSha } = await import("../src/publish/pagesPublisher.ts");
const { createGhCliAuthProvider, AuthToolMissingError } = await import("../src/publish/githubAuth.ts");

const ok = (name) => console.log(`✓ ${name}`);

// ── fixtures ─────────────────────────────────────────────────────────────────

function site(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-publish-")));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const GOOD_SITE = {
  "index.html": '<!doctype html><link rel="stylesheet" href="shared.css"><img src="img/logo.png" srcset="img/logo.png 1x, img/logo@2x.png 2x"><a href="about.html">소개</a><a href="https://example.com/">외부</a><a href="#top">위</a><script>location.href = "/never-a-link";</script>',
  "about.html": '<a href="./">처음</a><a href="sub/">하위</a><div style="background:url(img/logo.png)"></div>',
  "sub/index.html": "<p>하위</p>",
  "shared.css": "body{background:url('img/logo.png')} @import \"more.css\";",
  "more.css": "p{}",
  "img/logo.png": "PNG",
  "img/logo@2x.png": "PNG2",
  "agent.md": "이 문서는 공개 보관함에 있어 누구나 볼 수 있습니다\n\n# 보아치과",
  ".env": "SECRET=1",
  ".DS_Store": "x",
  ".hypeproof/state.json": "{}",
  "node_modules/x/index.js": "x",
  "server.key": "-----BEGIN PRIVATE KEY-----",
};

function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function fakeAuth(gh, { tokenValue, onBegin } = {}) {
  const calls = { begin: [] };
  return {
    calls,
    kind: "fake",
    async token() {
      return tokenValue === undefined ? gh.state.token : tokenValue;
    },
    async beginUserAuth(scopes, signedIn) {
      calls.begin.push({ scopes: [...scopes], signedIn });
      return onBegin ? onBegin(scopes, signedIn) : { code: "ABCD-1234", verificationUri: "https://github.com/login/device", done: new Promise(() => {}), cancel() {}, joined: false };
    },
  };
}

function deps(gh, root, extra = {}) {
  const c = clock();
  let n = 0;
  const d = {
    fetch: gh.fetch,
    sleep: c.sleep,
    now: c.now,
    auth: fakeAuth(gh),
    // REST through the (overridable) fetch, so a test can intercept API and site reads alike.
    transport: (token) => createFetchTransport({ base: gh.apiBase(), token, fetch: (u, i) => d.fetch(u, i) }),
    pagesBase: gh.pagesBase(),
    workspaceRoot: root,
    profileDefaultRepo: "boa-dental",
    customDomainAllowed: true,
    nonce: () => (++n).toString(16).padStart(32, "a"),
    userAuthWaitMs: 5 * 60_000,
    budgetMs: 30 * 60_000,
    ...extra,
  };
  return d;
}

const stepOf = (r, id) => r.steps.find((s) => s.id === id);
const tree = (gh, name) => {
  const repo = gh.repo(name);
  const head = repo.refs.get(repo.default_branch);
  const t = repo.trees.get(repo.commits.get(head).tree);
  return new Map(t.map((e) => [e.path, repo.blobs.get(e.sha).toString("utf8")]));
};

// ── contract ─────────────────────────────────────────────────────────────────
{
  for (const good of ["boa-dental", "dental-homepage", "a", "a1-b2-c3", "x".repeat(30)]) assert.ok(C.validateRepoName(good).ok, good);
  for (const bad of ["", "Boa-Dental", "boa_dental", "boa.dental", "-boa", "boa-", "boa--dental", "보아치과", "boa dental", "x".repeat(31)]) {
    assert.equal(C.validateRepoName(bad).ok, false, bad);
  }
  assert.equal(C.resolveRepoName(undefined, "boa-dental"), "boa-dental");
  assert.equal(C.resolveRepoName("  my-site ", "boa-dental"), "my-site");
  assert.equal(C.resolveRepoName(undefined, undefined), C.FALLBACK_REPO_NAME, "an old Service omits default_repo_name");
  assert.equal(C.resolveRepoName(undefined, "Bad Name"), C.FALLBACK_REPO_NAME, "a malformed default is not repaired into an unchosen name");

  assert.deepEqual(C.sitePublishAllowed({ enabled: true, strategy: "per_user_github_pages" }, false), { ok: true });
  for (const [p, minor, why] of [
    [null, false, "no profile"],
    [{ enabled: true, strategy: "hypeproof_gallery" }, false, "the gallery path"],
    [{ enabled: false, strategy: "per_user_github_pages" }, false, "off"],
    [{ enabled: "true", strategy: "per_user_github_pages" }, false, "string true"],
    [{ enabled: true, strategy: "per_user_github_pages" }, true, "minor"],
  ]) assert.equal(C.sitePublishAllowed(p, minor).ok, false, why);

  assert.deepEqual(C.normalizeCustomDomain("https://www.Boa-Dental.co.kr/"), { ok: true, domain: "www.boa-dental.co.kr" });
  for (const bad of ["boa", "boa.dental.co.kr/path", "1.2.3.4", "*.boa.kr", "octo.github.io", "boa_dental.kr", "boa.kr:8080"]) {
    assert.equal(C.normalizeCustomDomain(bad).ok, false, bad);
  }
  ok("contract: gate, slug, default name, domain normalization");
}

// ── scopes ───────────────────────────────────────────────────────────────────
{
  assert.deepEqual([...parseOAuthScopes("repo, workflow, gist")], ["repo", "workflow", "gist"]);
  assert.deepEqual(missingScopes(parseOAuthScopes("repo, gist")), ["workflow"]);
  assert.deepEqual(missingScopes(parseOAuthScopes("")), ["repo", "workflow"]);
  assert.deepEqual(missingScopes(parseOAuthScopes(null)), [], "no header (fine-grained token) is unknown, not missing");
  assert.deepEqual(missingScopes(parseOAuthScopes("repo,workflow")), []);
  ok("scopes: x-oauth-scopes parsing, unknown vs missing");
}

// ── preflight ────────────────────────────────────────────────────────────────
{
  // Positive control: a correct site with junk around it passes, and the junk stays home.
  const r = preflightSite(site(GOOD_SITE));
  assert.equal(r.blocked, false, JSON.stringify(r.issues));
  assert.deepEqual(r.issues, [], "no warnings for a clean site (JS location.href is not a link)");
  const paths = r.files.map((f) => f.path);
  for (const leak of [".env", ".DS_Store", ".hypeproof/state.json", "node_modules/x/index.js", "server.key"]) assert.ok(!paths.includes(leak), `${leak} never leaves`);
  assert.ok(paths.includes("agent.md"), "agent.md is published (D2)");

  const codes = (files) => preflightSite(site(files)).issues.map((i) => `${i.severity}:${i.code}`);
  assert.deepEqual(codes({ "home.html": "x" }), ["block:no_index"]);
  assert.deepEqual(codes({ "Index.html": "x" }), ["block:index_case"]);
  assert.ok(codes({ "index.html": '<img src="img/Logo.PNG">', "img/logo.png": "x" }).includes("block:ref_case"), "case mismatch blocks (macOS hides it)");
  assert.ok(codes({ "index.html": '<link href="/shared.css">', "shared.css": "" }).includes("block:ref_root_absolute"));
  assert.ok(codes({ "index.html": "<style>body{background:url(/bg.png)}</style>", "bg.png": "" }).includes("block:ref_root_absolute"), "inside <style> too");
  assert.ok(codes({ "index.html": '<script src=".hidden/app.js"></script>', ".hidden/app.js": "" }).includes("block:ref_excluded"));
  assert.deepEqual(codes({ "index.html": '<img src="missing.png">' }), ["warn:ref_missing"], "a link broken in the preview too only warns");
  assert.ok(codes({ "index.html": "x", "config.js": "const k = 'ghp_" + "a".repeat(36) + "'" }).includes("block:secret"));
  assert.ok(codes({ "index.html": "x", "a.txt": "sk-" + "b".repeat(30) }).includes("block:secret"));
  assert.ok(codes({ "index.html": "x", "a.md": "SUPABASE=sb_secret_" + "c".repeat(20) }).includes("block:secret"));
  assert.ok(codes({ "index.html": "x", "a.md": "-----BEGIN RSA PRIVATE KEY-----" }).includes("block:secret"));
  assert.ok(codes({ "index.html": "환자 900101-1234567" }).includes("block:rrn"), "resident registration number");
  assert.deepEqual(codes({ "index.html": "주문번호 991399-1234567 · task-list · disk-image" }), [], "an impossible date and ordinary words are not secrets");
  assert.deepEqual(codes({ "index.html": "x", "사진.jpg": "x" }), ["warn:non_ascii_name"]);
  assert.deepEqual(codes({ "index.html": "x", "agent.md": "# 보아치과" }), ["warn:agent_md_notice"]);
  const big = site({ "index.html": "x" });
  fs.writeFileSync(path.join(big, "video.mp4"), "");
  fs.truncateSync(path.join(big, "video.mp4"), 51 * 1024 * 1024);
  assert.ok(preflightSite(big).issues.some((i) => i.code === "file_too_large" && i.severity === "block"));
  // The secret message names file and line, never the value.
  const secret = preflightSite(site({ "index.html": "x", "k.js": "\n\nconst t='ghp_" + "z".repeat(36) + "'" })).issues[0];
  assert.match(secret.message_ko, /k\.js 3번째 줄/);
  assert.doesNotMatch(secret.message_ko, /ghp_/);
  ok("preflight: blocks preview-works/Pages-breaks and leaks; warns otherwise; never echoes a secret");
}

// ── D22 phone links / D24 markers (pure, exported for the e2e sweep) ──────────
{
  const { checkTelLinks, normalizePhoneDigits, countMarkers, markerSummary } = await import("../src/publish/sitePreflight.ts");
  assert.equal(normalizePhoneDigits("+82-2-1234-5678"), "0212345678");
  assert.equal(normalizePhoneDigits("+82 (0)2 1234 5678"), "0212345678");
  assert.equal(normalizePhoneDigits("82-10-1234-5678"), "01012345678");
  assert.equal(normalizePhoneDigits("02-1234-5678"), "0212345678");

  // Run-5-like page: four plain-text numbers, no tel: link → passes.
  const run5 = "<header>대표 02-1234-5678</header>\n<p>예약 02-1234-5678</p>\n<p>상담 010-9876-5432</p>\n<footer>전화 02.1234.5678 · 팩스 02-1234-5679</footer>\n<p>2026.10.13 개원 · 진료시간 09:30 ~ 18:30</p>";
  assert.deepEqual(checkTelLinks(run5).mismatches, [], "plain-text numbers without tel: pass");
  // Matching tel link, including the +82 form → passes.
  assert.deepEqual(checkTelLinks('<a href="tel:0212345678">02-1234-5678</a>').mismatches, []);
  assert.deepEqual(checkTelLinks('<p>02-1234-5678</p><a href="tel:+82-2-1234-5678">전화하기</a>').mismatches, [], "+82 normalizes to 0");
  // Two visible numbers (대표·상담), a button for each → passes.
  assert.deepEqual(checkTelLinks('<p>대표 02-1234-5678 · 상담 010-9876-5432</p><a href="tel:01098765432">상담 전화</a>').mismatches, []);
  // (a) link text shows one number, href dials another.
  const a = checkTelLinks('<p>안녕</p>\n<a href="tel:0298765432">02-1234-5678</a>');
  assert.deepEqual(a.mismatches, [{ line: 2, dials: "0298765432", shows: "0212345678", rule: "link_text" }]);
  // (b) number-less button still dialing the old number while the page shows the new one.
  const b = checkTelLinks('<p>새 번호 02-1234-5678</p>\n\n<a class="btn" href="tel:02-9876-5432">전화하기</a>');
  assert.deepEqual(b.mismatches, [{ line: 3, dials: "0298765432", shows: null, rule: "not_on_page" }]);
  // No visible number at all → a number-less button cannot be judged, passes (only rule a applies).
  assert.deepEqual(checkTelLinks('<p>2026.10.13 개원</p><a href="tel:0212345678">전화하기</a>').mismatches, [], "a date is not a phone number");
  // Comments and scripts are not page text.
  assert.deepEqual(checkTelLinks('<!-- 옛 번호 02-9876-5432 --><p>02-1234-5678</p><a href="tel:0212345678">전화</a>').mismatches, []);
  // data-phone without a script → warning flag only; with a script that sets href → fine.
  assert.equal(checkTelLinks('<a data-phone="0212345678">전화하기</a>').dataPhoneWithoutScript, true);
  assert.equal(checkTelLinks('<a data-phone="0212345678">전화하기</a><script>document.querySelectorAll("[data-phone]").forEach(a=>a.href="tel:"+a.dataset.phone)</script>').dataPhoneWithoutScript, false);

  // Through preflight: block with file + line, exact Korean; data-phone → warn.
  const blocked = preflightSite(site({ "index.html": '<p>새 번호 02-1234-5678</p>\n<a href="tel:0298765432">02-1234-5678</a>\n<a href="tel:0298765432">전화하기</a>' }));
  assert.equal(blocked.blocked, true);
  const msgs = blocked.issues.filter((i) => i.code === "tel_mismatch").map((i) => i.message_ko);
  assert.deepEqual(msgs, [
    "전화 링크 번호(tel:)가 화면의 전화번호와 달라요 — index.html 2번째 줄. 화면 번호는 02-1234-5678인데 누르면 0298765432로 걸려요. 두 곳을 같은 번호로 고친 뒤 다시 '인터넷에 올리기'를 눌러 주세요.",
    "전화 링크 번호(tel:)가 화면의 어느 전화번호와도 달라요 — index.html 3번째 줄. 누르면 0298765432로 걸려요. 화면에 보이는 번호와 같은 번호로 고친 뒤 다시 '인터넷에 올리기'를 눌러 주세요.",
  ]);
  const warned = preflightSite(site({ "index.html": '<p>02-1234-5678</p><a data-phone="0212345678">전화하기</a>' }));
  assert.equal(warned.blocked, false);
  assert.deepEqual(warned.issues.map((i) => `${i.severity}:${i.code}`), ["warn:data_phone_no_script"]);
  assert.equal(warned.issues[0].message_ko, "index.html: 전화 버튼(data-phone)은 있는데 전화를 걸어 주는 스크립트가 없어요. 이대로는 눌러도 전화가 걸리지 않아요.");

  // Markers: counted per label across files, first-appearance order; nothing when absent.
  const marked = "<!-- 여기고치기: 진료시간 -->\n<p>a</p>\n<!-- 여기고치기: 진료 안내 -->\n<!--여기고치기:진료시간-->";
  assert.deepEqual(countMarkers(marked), [{ label: "진료시간", count: 2 }, { label: "진료 안내", count: 1 }]);
  const two = preflightSite(site({ "index.html": marked, "about.html": "<!-- 여기고치기: 진료시간 -->\n<!-- 여기고치기: 진료 안내 -->\n<!-- 여기고치기: 진료시간 -->" }));
  assert.equal(markerSummary(two.markers), "다음에 고칠 표식: 진료시간 4곳 · 진료 안내 2곳");
  assert.equal(markerSummary(preflightSite(site({ "index.html": "<p>x</p>" })).markers), "");
  ok("D22/D24: tel mismatch blocks with file+line (link text, number-less button, +82), data-phone warns, markers counted by code");
}

// ── markers reach the result, the final step and the transcript; tel mismatch stops the run ──
{
  const { resultChatText } = await import("../src/publish/publishSite.ts");
  const gh = createMockGitHub();
  const r = await runPublishSite({}, deps(gh, site({ ...GOOD_SITE, "index.html": "<!doctype html><!-- 여기고치기: 진료시간 -->\n<p>평일 09:30 ~ 18:30</p>\n<!-- 여기고치기: 진료 안내 -->\n<p>안내</p>\n<!-- 여기고치기: 진료시간 -->\n<p>토 09:30 ~ 14:00</p>" })));
  assert.equal(r.verified, true, JSON.stringify(r));
  assert.deepEqual(r.markers, [{ label: "진료시간", count: 2 }, { label: "진료 안내", count: 1 }]);
  assert.match(stepOf(r, "verify").detail_ko, /새 버전으로 열리는 것을 확인했어요\. 다음에 고칠 표식: 진료시간 2곳 · 진료 안내 1곳$/);
  assert.match(resultChatText(r), /다음에 고칠 표식: 진료시간 2곳 · 진료 안내 1곳/);
  const gh2 = createMockGitHub();
  const stop = await runPublishSite({}, deps(gh2, site({ ...GOOD_SITE, "index.html": '<p>02-1234-5678</p>\n<a href="tel:0298765432">전화하기</a>' })));
  assert.equal(stop.error?.code, "preflight_blocked");
  assert.match(stop.error.message_ko, /전화 링크 번호\(tel:\)가 화면의 어느 전화번호와도 달라요 — index\.html 2번째 줄/);
  assert.equal(gh2.state.log.length, 0, "a wrong-number site never leaves the machine");
  ok("pipeline: marker counts in result/step/transcript; a tel mismatch blocks before any request");
}

// ── custom domain records ────────────────────────────────────────────────────
{
  assert.deepEqual(splitDomain("boadental.co.kr"), { apex: "boadental.co.kr", sub: "" });
  assert.deepEqual(splitDomain("www.boadental.co.kr"), { apex: "boadental.co.kr", sub: "www" });
  assert.deepEqual(splitDomain("blog.example.com"), { apex: "example.com", sub: "blog" });
  const apex = dnsRecordsFor("boadental.co.kr", "Octo-Clinic");
  assert.equal(apex.filter((r) => r.type === "A" && r.host === "@").length, 4);
  assert.equal(apex.filter((r) => r.type === "AAAA" && r.host === "@").length, 4);
  assert.deepEqual(apex.find((r) => r.type === "CNAME"), { type: "CNAME", host: "www", value: "octo-clinic.github.io" }, "CNAME never carries the repo name");
  const www = dnsRecordsFor("www.boadental.co.kr", "octo");
  assert.deepEqual(www[0], { type: "CNAME", host: "www", value: "octo.github.io" });
  assert.deepEqual(dnsRecordsFor("blog.example.com", "octo"), [{ type: "CNAME", host: "blog", value: "octo.github.io" }]);
  assert.ok(apex.some((r) => r.value === "185.199.108.153") && apex.some((r) => r.value === "2606:50c0:8003::153"));
  ok("domain: records for apex / www / other subdomain");
}

// ── happy path: new repo → verified ─────────────────────────────────────────
{
  const gh = createMockGitHub({ pagesReadyAfter: 3, runPollsToComplete: 3, cdnLagPolls: 2 });
  const root = site(GOOD_SITE);
  const seen = [];
  const r = await runPublishSite({}, deps(gh, root, { onStep: (s) => seen.push(`${s.id}:${s.status}`) }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.verified, true);
  assert.equal(r.url, siteUrlFor("octo-clinic", "boa-dental", gh.pagesBase()));
  assert.equal(r.planned_url, r.url);
  assert.equal(r.repo_name, "boa-dental", "profile default_repo_name used when no repo_name");
  assert.equal(r.error, undefined);
  assert.deepEqual(r.steps.map((s) => s.id), ["preflight", "auth", "repo", "pages", "commit", "build", "verify"]);
  assert.ok(r.steps.every((s) => s.status === "ok"), JSON.stringify(r.steps));
  assert.ok(seen.includes("build:pending") && seen.includes("verify:pending"), "progress reports the waits");

  const log = gh.state.log;
  const firstPagesPost = log.findIndex((l) => l.startsWith("POST /repos/octo-clinic/boa-dental/pages"));
  const lastPagesRead = log.map((l, i) => (l === "GET /repos/octo-clinic/boa-dental/pages" ? i : -1)).filter((i) => i > firstPagesPost)[2];
  const refUpdate = log.findIndex((l) => l.startsWith("PATCH /repos/octo-clinic/boa-dental/git/refs/heads/main"));
  assert.ok(firstPagesPost > 0 && lastPagesRead < refUpdate, "Pages set to workflow AND read back before the workflow file lands (#500)");
  assert.equal(log.filter((l) => l.startsWith("PATCH ")).length, 1, "one atomic commit");
  assert.equal(log.filter((l) => l.includes("/dispatches")).length, 0, "the push started the run; nothing re-dispatched");

  const t = tree(gh, "boa-dental");
  assert.equal(t.get(".github/workflows/pages.yml"), PAGES_WORKFLOW_YAML, "the skill's workflow, verbatim");
  assert.match(t.get("hps-build.txt"), /^[a-f0-9]{32}\n$/);
  assert.ok(t.has(".nojekyll") && t.has("index.html") && t.has("img/logo@2x.png") && t.has("agent.md"));
  assert.ok(!t.has("README.md"), "snapshot, not overlay: the auto_init README is not kept");
  assert.equal(r.markers, undefined, "no markers in the site → no marker line");
  assert.ok(![...t.keys()].some((k) => k.startsWith(".env") || k.includes("node_modules") || k.endsWith(".key")));
  ok("happy path: new repo, Pages before workflow, one commit, nonce verified, url only when verified");

  // Re-publish the same workspace: same repo, unchanged blobs reused, new nonce verified.
  const before = gh.state.log.length;
  const again = await runPublishSite({}, deps(gh, root, { nonce: () => "f".repeat(32) }));
  assert.equal(again.verified, true, JSON.stringify(again));
  const newLog = gh.state.log.slice(before);
  assert.ok(!newLog.some((l) => l === "POST /user/repos"), "existing repo reused");
  assert.equal(newLog.filter((l) => l.endsWith("/git/blobs")).length, 1, "only the changed nonce blob is uploaded");
  assert.match(stepOf(again, "repo").detail_ko, /이미 있는 내 저장소/);
  ok("re-publish: repo reused, unchanged blobs not re-uploaded");
}

// ── save stage (D-017) ───────────────────────────────────────────────────────
{
  const gh = createMockGitHub();
  const root = site(GOOD_SITE);
  const r = await runPublishSite({ stage: "save" }, deps(gh, root));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.verified, false);
  assert.equal(r.url, undefined, "a saved site has no verified address");
  assert.equal(r.planned_url, siteUrlFor("octo-clinic", "boa-dental", gh.pagesBase()));
  assert.ok(r.repo_url);
  assert.ok(!gh.state.log.some((l) => /\/pages/.test(l)), "no Pages API call at all");
  const t = tree(gh, "boa-dental");
  assert.ok(!t.has(".github/workflows/pages.yml"), "no workflow file (it would run red without Pages)");
  assert.ok(t.has(".nojekyll") && t.has("index.html"));
  assert.equal(gh.repo("boa-dental").runs.length, 0, "no Actions run");
  assert.match(stepOf(r, "commit").detail_ko, /404가 정상/);

  // check_only after a save: planned URL, Pages pending, nothing verified, nothing written.
  const before = gh.state.log.length;
  const c = await runPublishSite({ check_only: true }, deps(gh, undefined));
  assert.equal(c.ok, true);
  assert.equal(c.verified, false);
  assert.equal(stepOf(c, "pages").status, "pending");
  assert.ok(!gh.state.log.slice(before).some((l) => /^(POST|PUT|PATCH)/.test(l)), "check_only writes nothing");

  // Then publish: the saved repo is reused and becomes a verified site.
  const p = await runPublishSite({}, deps(gh, root));
  assert.equal(p.verified, true, JSON.stringify(p));
  ok("save stage: files only, no workflow, no Pages; check_only reads; publish completes it");
}

// ── consent hook: asked after sign-in with <login>/<repo>, before any write ───
{
  const gh = createMockGitHub();
  const asked = [];
  const no = await runPublishSite({}, deps(gh, site(GOOD_SITE), { confirmPublish: async (login, repo, stage) => (asked.push(`${login}/${repo}:${stage}`), false) }));
  assert.deepEqual(asked, ["octo-clinic/boa-dental:publish"], "the question names the real owner and repository");
  assert.equal(no.error?.code, "declined");
  assert.ok(!gh.state.log.some((l) => /^(POST|PUT|PATCH)/.test(l)), "a 'no' leaves GitHub untouched");
  const yes = await runPublishSite({}, deps(gh, site(GOOD_SITE), { confirmPublish: async () => true }));
  assert.equal(yes.verified, true);
  const checked = [];
  await runPublishSite({ check_only: true }, deps(gh, undefined, { confirmPublish: async () => (checked.push(1), false) }));
  assert.deepEqual(checked, [], "check_only writes nothing, so it asks nothing");
  ok("consent hook: after sign-in, before the first write; check_only never asks");
}

// ── D18 ⑤ divergence stop: never overwrite an edit made outside Studio ─────────
{
  const gh = createMockGitHub();
  const root = site(GOOD_SITE);
  let last;
  const tracked = (extra = {}) =>
    deps(gh, root, { lastPushedSha: () => last, onPushed: async (_l, _r, sha) => void (last = sha), ...extra });
  // First publish: nothing stored → proceeds and records its commit.
  const first = await runPublishSite({}, tracked());
  assert.equal(first.verified, true);
  const repo = gh.repo("boa-dental");
  assert.equal(last, repo.refs.get("main"), "the pushed commit is remembered");
  // Normal repeat push: remote head is still ours → push, and the record moves forward.
  fs.writeFileSync(path.join(root, "about.html"), "<p>바뀐 소개</p>");
  const again = await runPublishSite({}, tracked());
  assert.equal(again.verified, true, JSON.stringify(again));
  assert.equal(last, repo.refs.get("main"));
  // Someone edits on github.com (the pencil): a commit we did not make.
  const before = gh.state.log.length;
  const webEdit = await gh.fetch(`${gh.apiBase()}/repos/octo-clinic/boa-dental/contents/index.html`, {
    method: "PUT",
    headers: { authorization: `Bearer ${gh.state.token}` },
    body: JSON.stringify({ message: "Update index.html", content: Buffer.from("<p>웹에서 고침</p>").toString("base64") }),
  });
  assert.equal(webEdit.status, 201);
  const webHead = repo.refs.get("main");
  const stop = await runPublishSite({}, tracked());
  assert.equal(stop.ok, false);
  assert.equal(stop.error?.code, "remote_changed");
  assert.equal(stop.error.message_ko, "GitHub에서 직접 고친 내용이 있어 덮어쓰지 않았어요. 수업 중이면 보조강사에게, 수업 뒤라면 이 화면을 찍어 회신 주소로 보내 주세요.");
  assert.equal(stop.error.next_action_ko, "GitHub에 있는 내용은 그대로예요. 버튼을 다시 누르지 말고 안내를 기다려 주세요.", "works at home: nothing to do but wait for the reply");
  assert.equal(repo.refs.get("main"), webHead, "the web edit is intact");
  const after = gh.state.log.slice(before + 1);
  assert.ok(!after.some((l) => /git\/blobs|git\/trees|git\/commits$|PATCH /.test(l)), "stopped before uploading anything");
  // The save stage obeys the same rule.
  const save = await runPublishSite({ stage: "save" }, tracked());
  assert.equal(save.error?.code, "remote_changed");
  ok("divergence: first push records, repeat push proceeds, an outside edit stops both stages before any upload");
}

// ── check_only before anything exists ───────────────────────────────────────
{
  const gh = createMockGitHub();
  const r = await runPublishSite({ check_only: true, repo_name: "new-clinic" }, deps(gh, undefined));
  assert.equal(r.ok, true);
  assert.equal(r.verified, false);
  assert.equal(r.planned_url, siteUrlFor("octo-clinic", "new-clinic", gh.pagesBase()), "the 404 step gets its address");
  assert.equal(stepOf(r, "repo").status, "pending");
  ok("check_only: planned address before the repo exists");
}

// ── failures ────────────────────────────────────────────────────────────────
{
  // Preflight blocked → GitHub is never contacted.
  const gh = createMockGitHub();
  const r = await runPublishSite({}, deps(gh, site({ "index.html": '<link href="/a.css">', "a.css": "" })));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "preflight_blocked");
  assert.match(r.error.message_ko, /슬래시/);
  assert.equal(gh.state.log.length, 0, "nothing leaves the machine before preflight passes");
  ok("failure: preflight blocks before any request");
}
{
  const gh = createMockGitHub({ faults: { createRepo422: true } });
  const r = await runPublishSite({}, deps(gh, site(GOOD_SITE)));
  assert.equal(r.error?.code, "repo_name_taken", JSON.stringify(r));
  const gh2 = createMockGitHub();
  await runPublishSite({ stage: "save" }, deps(gh2, site(GOOD_SITE)));
  gh2.state.faults.repoOwner = "someone-else";
  const r2 = await runPublishSite({}, deps(gh2, site(GOOD_SITE)));
  assert.equal(r2.error?.code, "repo_name_taken", "a redirect to another owner's repo is not ours");
  assert.ok(!gh2.state.log.some((l) => l.startsWith("POST /repos/octo-clinic/boa-dental/pages")), "nothing written into it");
  const gh3 = createMockGitHub({ faults: { createRepo403: "You must verify your email address." } });
  assert.equal((await runPublishSite({}, deps(gh3, site(GOOD_SITE)))).error?.code, "email_unverified");
  ok("failure: 422 name taken / someone else's repo / unverified email");
}
{
  // Missing workflow scope, tool path: answer at once with the device code.
  const gh = createMockGitHub({ scopes: "repo, gist" });
  const d = deps(gh, site(GOOD_SITE), { userAuthWaitMs: 0 });
  const r = await runPublishSite({}, d);
  assert.equal(r.ok, false);
  assert.deepEqual(r.needs_user, { kind: "device_code", code: "ABCD-1234", verification_uri: "https://github.com/login/device" });
  assert.equal(r.error, undefined, "needs_user is not an error");
  assert.deepEqual(d.auth.calls.begin, [{ scopes: ["workflow"], signedIn: true }], "refresh adds only the missing scope");
  assert.match(stepOf(r, "auth").detail_ko, /ABCD-1234/);
  assert.ok(!gh.state.log.some((l) => l.includes("/user/repos")), "no repository work before the scope exists");

  // Button path: the participant finishes the code; the run continues and verifies.
  const gh2 = createMockGitHub({ scopes: "repo" });
  let shown = null;
  const auth = fakeAuth(gh2, {
    onBegin: () => ({ code: "WXYZ-9876", verificationUri: "https://github.com/login/device", joined: false, cancel() {}, done: Promise.resolve().then(() => { gh2.state.scopes = "repo, workflow"; return true; }) }),
  });
  const r2 = await runPublishSite({}, deps(gh2, site(GOOD_SITE), { auth, onDeviceCode: (c) => (shown = c) }));
  assert.equal(shown, "WXYZ-9876");
  assert.equal(r2.verified, true, JSON.stringify(r2));
  assert.equal(r2.needs_user, undefined);

  // Unknown scopes (no header) and GitHub refuses the workflow file → missing_scope.
  const gh3 = createMockGitHub({ scopes: null });
  gh3.state.scopes = null;
  const origPatch = gh3.fetch;
  const r3 = await runPublishSite({}, deps(gh3, site(GOOD_SITE), {
    fetch: async (url, init) => {
      if ((init?.method ?? "GET") === "PATCH") return new Response(JSON.stringify({ message: "refusing to allow an OAuth App to create or update workflow without workflow scope" }), { status: 404 });
      return origPatch(url, init);
    },
  }));
  assert.equal(r3.error?.code, "missing_scope", JSON.stringify(r3));

  // Not logged in at all → a fresh login, both scopes.
  const gh4 = createMockGitHub();
  const d4 = deps(gh4, site(GOOD_SITE), { userAuthWaitMs: 0 });
  d4.auth = fakeAuth(gh4, { tokenValue: null });
  const r4 = await runPublishSite({}, d4);
  assert.ok(r4.needs_user);
  assert.deepEqual(d4.auth.calls.begin, [{ scopes: ["repo", "workflow"], signedIn: false }]);

  // gh not installed.
  const d5 = deps(createMockGitHub(), site(GOOD_SITE));
  d5.auth = { kind: "fake", token: async () => { throw new AuthToolMissingError(); }, beginUserAuth: async () => { throw new Error("unused"); } };
  const r5 = await runPublishSite({}, d5);
  assert.equal(r5.error?.code, "gh_missing");
  assert.match(r5.error.next_action_ko, /GitHub CLI/);
  ok("failure: missing workflow scope (device code / interactive / refused write), not logged in, gh missing");
}
{
  const gh = createMockGitHub({ faults: { pagesNeverWorkflow: true } });
  const r = await runPublishSite({}, deps(gh, site(GOOD_SITE)));
  assert.equal(r.error?.code, "pages_not_ready", JSON.stringify(r));
  assert.equal(gh.state.log.filter((l) => l === "GET /repos/octo-clinic/boa-dental/pages").length, 1 + 12, "the skill's bounded 12 reads");
  assert.ok(!gh.state.log.some((l) => l.startsWith("PATCH ")), "the workflow file is NOT pushed when Pages never read back as workflow");
  ok("failure: Pages build_type never becomes workflow → bounded, nothing pushed");
}
{
  const gh = createMockGitHub({ faults: { runConclusion: "failure" } });
  const r = await runPublishSite({}, deps(gh, site(GOOD_SITE)));
  assert.equal(r.error?.code, "actions_failed", JSON.stringify(r));
  assert.match(r.error.next_action_ko, /actions\/runs\/\d+/, "the log link is handed over");
  assert.equal(gh.state.log.filter((l) => l.includes("/dispatches")).length, 1, "one re-dispatch (the skill's remedy), then report");
  assert.equal(r.verified, false);
  assert.equal(r.url, undefined);
  ok("failure: Actions run fails twice → actions_failed with the run link");
}
{
  const gh = createMockGitHub({ faults: { neverServeNonce: true } });
  const r = await runPublishSite({}, deps(gh, site(GOOD_SITE)));
  assert.equal(r.error?.code, "verify_timeout", JSON.stringify(r));
  assert.equal(r.url, undefined, "an old deployment answering 200 is not success");
  // The same situation inside a tool's short budget: not an error, just not confirmed yet.
  const gh2 = createMockGitHub({ faults: { neverServeNonce: true } });
  const r2 = await runPublishSite({}, deps(gh2, site(GOOD_SITE), { budgetMs: 200_000 }));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.verified, false);
  assert.equal(r2.error, undefined);
  assert.equal(stepOf(r2, "verify").status, "pending");
  ok("failure: nonce never visible → verify_timeout (button) / still building (tool budget)");
}
{
  for (const kind of ["retry-after", "reset"]) {
    const gh = createMockGitHub({ faults: { rateLimitOnce: { match: /^POST \/repos\/.*\/git\/trees$/, kind } } });
    const slept = [];
    const d = deps(gh, site(GOOD_SITE));
    gh.state.now = d.now;
    const s = d.sleep;
    d.sleep = async (ms) => { slept.push(ms); return s(ms); };
    const r = await runPublishSite({}, d);
    assert.equal(r.verified, true, `${kind}: ${JSON.stringify(r)}`);
    assert.ok(slept.some((ms) => ms >= 1000 && ms <= 3000), `${kind}: waited per the header (${slept.slice(0, 5)})`);
  }
  // A limit longer than we are willing to sleep is reported, not slept through.
  const c = clock();
  const api = createGitHubApi({
    transport: async () => ({ status: 403, headers: new Headers({ "retry-after": "3600" }), json: {} }),
    deps: { now: c.now, sleep: c.sleep },
  });
  await assert.rejects(api.request("GET", "/user"), (e) => e.kind === "rate_limited");
  ok("rate limit: retry-after and x-ratelimit-reset honored; an hour-long limit becomes rate_limited");
}

// ── custom domain state machine ─────────────────────────────────────────────
{
  // A cohort without `publishing.custom_domain: true` refuses the input before any request.
  const off = createMockGitHub();
  const r0 = await runPublishSite({ custom_domain: "www.boadental.co.kr" }, deps(off, site(GOOD_SITE), { customDomainAllowed: false }));
  assert.equal(r0.error?.code, "not_allowed");
  assert.equal(off.state.log.length, 0);
}
{
  const gh = createMockGitHub();
  const root = site(GOOD_SITE);
  const r = await runPublishSite({ custom_domain: "www.boadental.co.kr" }, deps(gh, root));
  assert.equal(r.verified, true, "github.io verified BEFORE the domain is attached");
  assert.equal(r.domain.state, "dns_pending");
  assert.equal(r.domain.name, "www.boadental.co.kr");
  assert.deepEqual(r.domain.dns_records[0], { type: "CNAME", host: "www", value: "octo-clinic.github.io" });
  assert.equal(gh.repo("boa-dental").pages.cname, "www.boadental.co.kr");
  assert.equal(tree(gh, "boa-dental").get("CNAME"), "www.boadental.co.kr\n");

  // DNS done, certificate not yet: check_only → cert_pending (HTTPS not forced).
  gh.state.faults.healthStatus = [202, 200];
  gh.state.faults.healthDomain = { dns_resolves: true, is_cname_to_github_user_domain: true };
  gh.state.faults.certState = "authorization_pending";
  const d = deps(gh, undefined, { fetch: async (url, init) => (String(url).includes("boadental") ? new Response("down", { status: 503 }) : gh.fetch(url, init)), budgetMs: 60_000 });
  const c1 = await runPublishSite({ check_only: true, custom_domain: "www.boadental.co.kr" }, d);
  assert.equal(c1.domain.state, "cert_pending", JSON.stringify(c1));
  assert.ok(!gh.repo("boa-dental").pages.https_enforced);

  // Certificate issued: check_only enforces HTTPS.
  gh.state.faults.certState = "approved";
  const c2 = await runPublishSite({ check_only: true }, deps(gh, undefined, { fetch: d.fetch, budgetMs: 60_000 }));
  assert.equal(c2.domain.state, "https_enforced", JSON.stringify(c2));
  assert.equal(gh.repo("boa-dental").pages.https_enforced, true);
  assert.equal(c2.verified, false, "the domain host here never served the nonce → not verified");
  assert.equal(c2.url, undefined);
  ok("domain: dns_pending → cert_pending → https_enforced; HTTPS only after the certificate");
}

// ── gh CLI provider (scripted execFile) ─────────────────────────────────────
{
  function fakeExec(script) {
    const calls = [];
    const fn = (file, args, _opts, cb) => {
      calls.push([file, ...args]);
      const child = { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { end() {} }, kill() { child.killed = true; } };
      queueMicrotask(() => script(file, args, child, cb));
      return child;
    };
    return { fn, calls };
  }
  const missing = fakeExec((file, args, child, cb) => cb(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "", ""));
  await assert.rejects(createGhCliAuthProvider({ execFile: missing.fn, platform: "darwin" }).token(), AuthToolMissingError);
  assert.deepEqual(missing.calls.map((c) => c[0]), ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"], "PATH, then Homebrew locations a Dock-launched app may not see");

  let finish;
  const ok1 = fakeExec((file, args, child, cb) => {
    if (args[0] === "--version") return cb(null, "gh version 2.89.0 (2026-03-26)\n", "");
    if (args[1] === "token") return cb(null, "gho_" + "x".repeat(36) + "\n", "");
    if (args[1] === "refresh") {
      child.stderr.emit("data", "\n! First copy your one-time code: QW12-ER34\nOpen this URL to continue in your web browser: https://github.com/login/device\n");
      finish = () => cb(null, "", "");
    }
  });
  const p = createGhCliAuthProvider({ execFile: ok1.fn, platform: "darwin" });
  assert.equal(await p.token(), "gho_" + "x".repeat(36));
  const a = await p.beginUserAuth(["workflow"], true);
  assert.equal(a.code, "QW12-ER34");
  assert.equal(a.joined, false);
  assert.deepEqual(ok1.calls.find((c) => c[2] === "refresh"), ["gh", "auth", "refresh", "--hostname", "github.com", "--scopes", "workflow"]);
  const b = await p.beginUserAuth(["workflow"], true);
  assert.equal(b.joined, true, "a second call joins the running flow (one code on screen)");
  assert.equal(b.code, "QW12-ER34");
  assert.equal(ok1.calls.filter((c) => c[2] === "refresh").length, 1);
  finish();
  assert.equal(await a.done, true);

  const garbage = fakeExec((file, args, child, cb) => (args[0] === "--version" ? cb(null, "gh version 2.89.0", "") : cb(null, "To get started with GitHub CLI, please run: gh auth login\n", "")));
  assert.equal(await createGhCliAuthProvider({ execFile: garbage.fn, platform: "darwin" }).token(), null, "non-token output is not a token");
  ok("gh provider: resolution, token, device code parse, joined flow");
}

// Git blob ids match git's own (the integrity check depends on it).
assert.equal(gitBlobSha(new TextEncoder().encode("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
ok("git blob sha matches `git hash-object`");

console.log("\n✓ publish-site smoke 통과");
