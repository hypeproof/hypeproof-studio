// "GitHub에서 이어하기" — src/publish/githubContinue.ts, the folder → repository rule in the
// pipeline, and the start page's choice. Against the scripted GitHub; each behaviour has a
// control that must pass and one that must fail:
//   - which repositories count as class sites (the button's description, or Pages + agent.md);
//   - the download: exactly what a publish uploads, blob ids checked, never into an existing
//     folder, nothing left behind on failure, hostile paths refused;
//   - the folder → repository rule: a folder that never published from this computer gets a NEW
//     repository; a bound folder publishes to its own; an explicit name wins;
//   - two computers: publish on A, bring down on B, publish from B on top of A's commit, and A's
//     stale copy is stopped instead of overwriting B's work;
//   - the start page: look first, then continue / start new / sign in; stale answers ignored.
//
// Run: node --experimental-strip-types test/github-continue.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createMockGitHub } from "./fixtures/mock-github.mjs";

const { createGitHubApi, createFetchTransport } = await import("../src/publish/githubApi.ts");
const { findClassRepos, downloadRepo, nextFreeFolder, firstFreeRepoName, remoteHead } = await import("../src/publish/githubContinue.ts");
const { REPO_DESCRIPTION } = await import("../src/publish/pagesPublisher.ts");
const { runPublishSite } = await import("../src/publish/publishSite.ts");
const { PublishRegistry } = await import("../src/publish/publishRegistry.ts");

const ok = (name) => console.log(`✓ ${name}`);
const LOGIN = "octo-clinic";

function apiFor(gh) {
  return createGitHubApi({
    transport: createFetchTransport({ base: gh.apiBase(), token: gh.state.token, fetch: gh.fetch }),
    deps: { sleep: async () => {}, now: () => Date.now() },
  });
}

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function site(files) {
  const dir = tmp("hps-continue-site-");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

/** Every file under `dir` as {relative path: bytes as latin1}, sorted. */
function listing(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(dir, r)).toString("latin1");
    }
  };
  walk("");
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10, 0x80]);
const SITE = {
  "index.html": '<!doctype html><meta charset="utf-8"><title>보아치과</title><link rel="stylesheet" href="shared.css"><img src="images/logo.png"><a href="about.html">소개</a>',
  "about.html": '<!doctype html><meta charset="utf-8"><a href="index.html">처음</a>',
  "shared.css": "body{font-family:sans-serif}",
  "images/logo.png": PNG,
  "agent.md": "이 문서는 공개 보관함에 있어 누구나 볼 수 있습니다\n\n# 보아치과\n",
};

function deps(gh, root, extra = {}) {
  let t = 1_000_000;
  let n = 0;
  return {
    fetch: gh.fetch,
    sleep: async (ms) => { t += ms; },
    now: () => t,
    auth: { kind: "fake", token: async () => gh.state.token, beginUserAuth: async () => { throw new Error("no sign-in in this test"); } },
    transport: (token) => createFetchTransport({ base: gh.apiBase(), token, fetch: gh.fetch }),
    pagesBase: gh.pagesBase(),
    workspaceRoot: root,
    profileDefaultRepo: "boa-dental",
    customDomainAllowed: false,
    nonce: () => (++n).toString(16).padStart(32, "b"),
    userAuthWaitMs: 0,
    budgetMs: 30 * 60_000,
    ...extra,
  };
}

/** One computer: its own registry wired exactly as publishHost.ts wires the pipeline. */
function computer(gh, root) {
  const store = new Map();
  const registry = new PublishRegistry({ get: (k) => store.get(k), update: async (k, v) => void store.set(k, v) });
  const same = (a, b) => fs.realpathSync(a) === fs.realpathSync(b);
  const publish = (input = {}) =>
    runPublishSite(input, deps(gh, root(), {
      folderRepo: (login) => {
        const bound = registry.boundRepo(login, root(), same);
        return bound ? { repo: bound } : "new";
      },
      confirmPublish: async (login, repo) => {
        if (!registry.isRegistered(login, repo)) await registry.register(login, repo, root());
        return true;
      },
      lastPushedSha: (login, repo) => registry.get(login, repo)?.lastPushedSha,
      onPushed: async (login, repo, sha) => registry.recordPush(login, repo, sha, root()),
    }));
  return { registry, publish, same };
}

// ── which repositories are class sites ───────────────────────────────────────
{
  const gh = createMockGitHub();
  const api = apiFor(gh);
  gh.seedRepo("unrelated", { "README.md": "notes" });
  gh.seedRepo("shell-made", { "index.html": "<p>a</p>", "agent.md": "# a" }, { pages: true });
  gh.seedRepo("pages-no-agent", { "index.html": "<p>b</p>" }, { pages: true });
  gh.seedRepo("button-made", { "index.html": "<p>c</p>" }, { description: REPO_DESCRIPTION });
  const r = await findClassRepos(api, LOGIN);
  assert.equal(r.ok, true);
  assert.deepEqual(r.repos.map((x) => x.name), ["button-made", "shell-made"], "button-made by its description, shell-made by Pages + agent.md; most recent first");
  assert.equal(r.repos[0].defaultBranch, "main");
  assert.ok(r.repos[0].pushedAt > r.repos[1].pushedAt);
  const none = await findClassRepos(apiFor(createMockGitHub()), LOGIN);
  assert.deepEqual(none, { ok: true, repos: [] }, "an empty account has no class sites");
  gh.state.faults.listRepos500 = true;
  const broken = await findClassRepos(api, LOGIN);
  assert.equal(broken.ok, false, "a failed listing is not 'no sites'");
  ok("class sites: the description or Pages + agent.md; unrelated and plain Pages repositories are not offered; a failed listing is reported");
}

// ── the download ──────────────────────────────────────────────────────────────
{
  const gh = createMockGitHub();
  const api = apiFor(gh);
  const a = site({ ...SITE, ".env": "SECRET=1", "node_modules/x/index.js": "x" });
  const published = await runPublishSite({}, deps(gh, a));
  assert.equal(published.verified, true, JSON.stringify(published.error));
  const repo = gh.repo("boa-dental");
  const onGitHub = [...repo.trees.get(repo.commits.get(repo.refs.get("main")).tree)].map((e) => e.path).sort();
  assert.ok(onGitHub.includes(".github/workflows/pages.yml") && onGitHub.includes("hps-build.txt") && onGitHub.includes(".nojekyll"), "control: the repository does hold the generated files");

  const dest = path.join(tmp("hps-continue-home-"), "HypeProofDentalSeminar");
  const d = await downloadRepo(api, LOGIN, "boa-dental", "main", dest);
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.head, repo.refs.get("main"), "the commit the files came from");
  assert.equal(d.head, await remoteHead(api, LOGIN, "boa-dental", "main"));
  const expected = listing(site(SITE));
  assert.deepEqual(listing(dest), expected, "exactly the publishable files, byte for byte (the PNG included)");
  assert.equal(d.files, Object.keys(expected).length);

  // Never into an existing folder; that folder is left exactly as it was.
  const before = listing(dest);
  const again = await downloadRepo(api, LOGIN, "boa-dental", "main", dest);
  assert.equal(again.ok, false);
  assert.equal(again.code, "dest_exists");
  assert.deepEqual(listing(dest), before, "the existing folder is untouched");

  // A corrupted blob: refused, and the half-written folder is removed.
  const logoSha = repo.trees.get(repo.commits.get(repo.refs.get("main")).tree).find((e) => e.path === "images/logo.png").sha;
  gh.state.faults.corruptBlob = logoSha;
  const bad = path.join(path.dirname(dest), "corrupt");
  const corrupt = await downloadRepo(api, LOGIN, "boa-dental", "main", bad);
  assert.equal(corrupt.code, "integrity");
  assert.equal(fs.existsSync(bad), false, "nothing is left behind");
  gh.state.faults.corruptBlob = null;

  // A path that would climb out of the folder: refused before anything is written.
  gh.seedRepo("hostile", { "../evil.txt": "x", "index.html": "<p>x</p>" }, { description: REPO_DESCRIPTION });
  const evilDest = path.join(path.dirname(dest), "hostile");
  const evil = await downloadRepo(api, LOGIN, "hostile", "main", evilDest);
  assert.equal(evil.code, "unsafe_path");
  assert.equal(fs.existsSync(evilDest), false);
  assert.equal(fs.existsSync(path.join(path.dirname(dest), "evil.txt")), false);

  // An empty repository: nothing to continue.
  await api.request("POST", "/user/repos", { name: "empty-one", auto_init: false });
  const empty = await downloadRepo(api, LOGIN, "empty-one", "main", path.join(path.dirname(dest), "empty"));
  assert.equal(empty.code, "empty");
  ok("download: the publishable files byte for byte; never into an existing folder; corrupt blob, hostile path and empty repository refused with nothing left behind");
}

// ── names ─────────────────────────────────────────────────────────────────────
{
  const taken = new Set(["/h/Seminar", "/h/Seminar-2"]);
  assert.equal(nextFreeFolder("/h/Seminar", (p) => taken.has(p)), "/h/Seminar-3");
  assert.equal(nextFreeFolder("/h/Other", (p) => taken.has(p)), "/h/Other", "control: a free base is used as is");
  const gh = createMockGitHub();
  const api = apiFor(gh);
  assert.deepEqual(await firstFreeRepoName(api, LOGIN, "boa-dental"), { ok: true, name: "boa-dental" }, "control: a free name is used as is");
  gh.seedRepo("boa-dental", { "a.txt": "a" });
  gh.seedRepo("boa-dental-2", { "a.txt": "a" });
  assert.deepEqual(await firstFreeRepoName(api, LOGIN, "boa-dental"), { ok: true, name: "boa-dental-3" });
  const long = "a".repeat(30);
  gh.seedRepo(long, { "a.txt": "a" });
  const short = await firstFreeRepoName(api, LOGIN, long);
  assert.equal(short.name, `${"a".repeat(28)}-2`, "the base is shortened, never the suffix");
  ok("names: first free folder and repository name; a free base is kept; long names stay within 30");
}

// ── the folder → repository rule in the pipeline ─────────────────────────────
{
  const gh = createMockGitHub();
  const a = site(SITE);
  assert.equal((await runPublishSite({}, deps(gh, a))).verified, true);
  const headA = gh.repo("boa-dental").refs.get("main");

  // A folder that never published from here: a NEW repository, the existing one untouched.
  const b = site({ ...SITE, "index.html": "<p>다른 컴퓨터에서 새로 시작</p>" });
  const fresh = await runPublishSite({}, deps(gh, b, { folderRepo: () => "new" }));
  assert.equal(fresh.verified, true, JSON.stringify(fresh.error));
  assert.equal(fresh.repo_name, "boa-dental-2");
  assert.equal(gh.repo("boa-dental").refs.get("main"), headA, "the site made elsewhere is untouched");

  // Bound: its own repository, by name.
  const bound = await runPublishSite({}, deps(gh, b, { folderRepo: () => ({ repo: "boa-dental-2" }) }));
  assert.equal(bound.repo_name, "boa-dental-2");
  assert.equal(gh.repo("boa-dental").refs.get("main"), headA);

  // An explicit name wins over both.
  const named = await runPublishSite({ repo_name: "my-clinic" }, deps(gh, b, { folderRepo: () => "new" }));
  assert.equal(named.repo_name, "my-clinic");

  // Control: no folderRepo → the default name, as before.
  const legacy = await runPublishSite({}, deps(gh, a));
  assert.equal(legacy.repo_name, "boa-dental");
  ok("pipeline: an unbound folder makes a new repository (the old one untouched); bound → its own; explicit name wins; absent → default");
}

// ── registry: which repository a folder is bound to ───────────────────────────
{
  const store = new Map();
  let t = 0;
  const reg = new PublishRegistry({ get: (k) => store.get(k), update: async (k, v) => void store.set(k, v) }, () => ++t);
  const same = (x, y) => x === y;
  assert.equal(reg.boundRepo("Octo", "/f/one", same), undefined, "control: nothing registered");
  await reg.register("octo", "site-a", "/f/one");
  await reg.register("octo", "site-b", "/f/two");
  assert.equal(reg.boundRepo("OCTO", "/f/one", same), "site-a", "login compared case-insensitively");
  assert.equal(reg.boundRepo("octo", "/f/two", same), "site-b");
  assert.equal(reg.boundRepo("other", "/f/one", same), undefined, "another GitHub account on a shared Mac is not bound");
  assert.equal(reg.boundRepo("octo", "/f/three", same), undefined);
  await reg.register("octo", "site-c", "/f/one");
  assert.equal(reg.boundRepo("octo", "/f/one", same), "site-c", "the latest registration from a folder wins");
  ok("registry: a folder's repository per login; unknown folder or login → none; latest wins");
}

// ── two computers ─────────────────────────────────────────────────────────────
{
  const gh = createMockGitHub();
  const api = apiFor(gh);
  const folderA = site(SITE);
  const A = computer(gh, () => folderA);
  const first = await A.publish();
  assert.equal(first.verified, true, JSON.stringify(first.error));
  assert.equal(first.repo_name, "boa-dental", "a first-ever folder takes the default name (it is free)");
  const headA = gh.repo("boa-dental").refs.get("main");

  // Computer B brings it down, as prepareContinue does: download + register + record the commit.
  const folderB = path.join(tmp("hps-continue-b-"), "HypeProofDentalSeminar");
  const B = computer(gh, () => folderB);
  const d = await downloadRepo(api, LOGIN, "boa-dental", "main", folderB);
  assert.equal(d.ok, true);
  await B.registry.register(LOGIN, "boa-dental", folderB);
  await B.registry.recordPush(LOGIN, "boa-dental", d.head, folderB);
  fs.writeFileSync(path.join(folderB, "about.html"), "<p>B에서 고친 소개</p>");
  const fromB = await B.publish();
  assert.equal(fromB.verified, true, JSON.stringify(fromB.error));
  assert.equal(fromB.repo_name, "boa-dental", "B continues the same site");
  const repo = gh.repo("boa-dental");
  const headB = repo.refs.get("main");
  assert.deepEqual(repo.commits.get(headB).parents, [headA], "B's commit is built on A's");
  const live = await gh.fetch(`${gh.pagesBase()}/${LOGIN}/boa-dental/about.html`);
  assert.equal(await live.text(), "<p>B에서 고친 소개</p>");

  // A's copy is now stale: its press stops instead of overwriting B's work.
  fs.writeFileSync(path.join(folderA, "index.html"), "<p>A의 오래된 사본</p>");
  const stale = await A.publish();
  assert.equal(stale.error?.code, "remote_changed");
  assert.equal(repo.refs.get("main"), headB, "B's work is intact");
  ok("two computers: B brings A's site down and publishes on top of A's commit; A's stale copy is stopped");
}

// ── the start page ───────────────────────────────────────────────────────────
{
  const require = createRequire(import.meta.url);
  const bundle = await build({
    stdin: { contents: "export * from './src/startPage.ts';", resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
    bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false,
  });
  const served = {
    activity_kind: "classroom", profile_id: "dental", display_name: "Dental", ux: { coach: { naming_mode: "fixed", fallback_name: "Coach" } }, welcome: {},
    series_index: 1, series_total: 1, workspace_root: "~/HypeProofDentalSeminar", publishing: { enabled: true, strategy: "per_user_github_pages" },
  };
  let response = served;
  const states = [];
  let stored = "old";
  const ctx = {
    workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} },
    secrets: { get: async () => stored, store: async (_k, v) => { stored = v; }, delete: async () => { stored = undefined; } },
    extension: { packageJSON: { version: "test" } }, subscriptions: [],
  };
  const chat = {
    openInEditor: async () => {}, ensureProfile: async () => response, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {},
    hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => "Coach", coachNameIsChosen: () => true,
  };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => "http://local/v1" }) }, window: {}, commands: { executeCommand: async () => {} } };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, AbortSignal, URL, process, TextEncoder, setTimeout,
    fetch: async () => new Response(JSON.stringify(response), { status: 200 }),
  });

  const classRoot = "/h/HypeProofDentalSeminar";
  const repos = [
    { name: "boa-dental-2", pushedAt: "2026-10-14T09:00:00Z", htmlUrl: "https://github.com/octo-clinic/boa-dental-2", defaultBranch: "main" },
    { name: "boa-dental", pushedAt: "2026-10-13T09:00:00Z", htmlUrl: "https://github.com/octo-clinic/boa-dental", defaultBranch: "main" },
  ];
  const calls = { prepare: [], find: 0, signIn: 0 };
  let findAnswer = { status: "found", login: LOGIN, repos };
  let release = null;
  const source = {
    allowed: (p) => p.publishing?.enabled === true,
    classRoot: (p) => (p.workspace_root ? classRoot : null),
    newFolder: (root) => `${root}-3`,
    find: async () => { calls.find++; if (release) await new Promise((r) => (release = r)); return findAnswer; },
    signIn: async () => { calls.signIn++; findAnswer = { status: "found", login: LOGIN, repos }; return true; },
    prepare: async (args) => { calls.prepare.push(args); return { ok: true, folder: `${classRoot}-2`, downloaded: true }; },
  };
  const begun = [];
  const make = (src) => {
    const page = new mod.exports.StartPage(ctx, chat, async (profile, commit, selectedDirectory) => { begun.push(selectedDirectory ?? profile.workspace_root); await commit(); return false; }, src);
    page.panel = { webview: { postMessage: async (m) => void states.push(m) } };
    return page;
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const last = () => states.at(-1).state;

  // Continue: look first, then the chosen site's folder is the one that opens. The answer is
  // held back so the card can be seen while it looks (a real GitHub takes a moment).
  let page = make(source);
  release = () => {};
  await page.handle({ type: "connectCourse", token: "code-1" });
  assert.equal(last().candidate, true);
  assert.equal(last().github?.status, "checking", "the card says it is looking");
  const answer = release;
  release = null;
  answer();
  await settle();
  // JSON round trip: the state object was made in the bundle's VM context (another realm).
  assert.deepEqual(JSON.parse(JSON.stringify(last().github)), { status: "found", repos: repos.map(({ name, pushedAt }) => ({ name, pushedAt })), newFolder: "HypeProofDentalSeminar-3" });
  assert.ok(!JSON.stringify(states).includes("code-1"), "the code never reaches the UI");
  await page.handle({ type: "continueFromGithub", repo: "boa-dental" });
  assert.equal(calls.prepare.length, 1);
  assert.equal(calls.prepare[0].repo.name, "boa-dental", "the picked site, not the most recent one");
  assert.equal(calls.prepare[0].classRoot, classRoot);
  assert.deepEqual(begun, [`${classRoot}-2`], "the folder the site came down into is the one that opens");
  assert.equal(stored, "code-1");

  // A name that was not offered is ignored.
  page = make(source);
  await page.handle({ type: "connectCourse", token: "code-2" });
  await settle();
  await page.handle({ type: "continueFromGithub", repo: "someone-else" });
  assert.equal(calls.prepare.length, 1, "only an offered site is brought down");

  // Start new: the next free folder, no download.
  await page.handle({ type: "startNew" });
  assert.deepEqual(begun.at(-1), `${classRoot}-3`);
  assert.equal(calls.prepare.length, 1);

  // A failed download keeps the card and says why; nothing opens.
  page = make({ ...source, prepare: async () => ({ ok: false, message: "GitHub에서 홈페이지를 내려받지 못했어요. 잠시 뒤 다시 눌러 주세요." }) });
  await page.handle({ type: "connectCourse", token: "code-3" });
  await settle();
  const opened = begun.length;
  await page.handle({ type: "continueFromGithub", repo: "boa-dental" });
  assert.equal(begun.length, opened);
  assert.equal(last().candidate, true);
  assert.match(last().error, /내려받지 못했어요/);

  // Not signed in: the card offers sign-in; after it, the sites are offered.
  findAnswer = { status: "signin" };
  page = make(source);
  await page.handle({ type: "connectCourse", token: "code-4" });
  await settle();
  assert.equal(last().github?.status, "signin");
  await page.handle({ type: "githubSignIn" });
  await settle();
  assert.equal(calls.signIn, 1);
  assert.equal(last().github?.status, "found");

  // A slow answer for a code that was replaced is ignored.
  release = () => {};
  findAnswer = { status: "found", login: LOGIN, repos };
  page = make(source);
  const firstLook = page.handle({ type: "connectCourse", token: "code-5" });
  await firstLook;
  const pending = release;
  release = null;
  await page.handle({ type: "cancelCandidate" });
  pending();
  await settle();
  assert.equal(last().github, undefined, "a cancelled candidate shows no GitHub choice");

  // Controls: no source, or a cohort that does not publish → no look at all.
  const before = calls.find;
  page = make(undefined);
  await page.handle({ type: "connectCourse", token: "code-6" });
  await settle();
  assert.equal(last().github, undefined);
  response = { ...served, publishing: { enabled: false, strategy: "none" } };
  page = make(source);
  await page.handle({ type: "connectCourse", token: "code-7" });
  await settle();
  assert.equal(last().github, undefined);
  assert.equal(calls.find, before, "nothing asked GitHub");
  ok("start page: looks first; continue opens the picked site's folder; start new opens the next free folder; failure keeps the card; sign-in then offer; stale answers and non-publishing cohorts show nothing");
}

console.log("\n✓ github-continue smoke 통과");
