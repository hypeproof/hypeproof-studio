// "GitHub에서 이어하기" / "프로젝트 변경" on this computer — src/publish/repoCheckout.ts, with
// real git against a local bare repository standing in for GitHub (no network, no gh login).
// Each behaviour has a control:
//   - which folder belongs to a repository (registered, `<class>-<repo>`, a plain copy) and which
//     does not (a clone of another repository → the next free name);
//   - an existing folder brought to GitHub's head: "open" keeps the files, "pull" replaces them
//     and keeps a backup; a plain folder becomes a clone in place;
//   - a failed clone leaves nothing behind; git missing is told apart from other failures.
//
// Run: node --experimental-strip-types test/repo-checkout.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, execFileSync } from "node:child_process";

const { sameRepoUrl, locateRepoFolder, cloneRepo, syncClone } = await import("../src/publish/repoCheckout.ts");
const { canonicalizeExistingPath } = await import("../src/workspaceRouting.ts");

const ok = (name) => console.log(`✓ ${name}`);
const exec = (file, args, opts) =>
  new Promise((resolve) =>
    execFile(file, args, { timeout: opts.timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) =>
      resolve({ ok: !err, missing: !!err && err.code === "ENOENT", stdout: String(stdout), stderr: String(stderr) }),
    ),
  );
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-checkout-"));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");

try {
  // "GitHub": a bare repository with two commits on main.
  const origin = path.join(tmp, "origin.git");
  const seed = path.join(tmp, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  git(seed, "config", "user.email", "t@example.invalid"); git(seed, "config", "user.name", "t");
  write(seed, "index.html", "v1\n"); git(seed, "add", "."); git(seed, "commit", "-qm", "v1");
  write(seed, "index.html", "v2\n"); write(seed, "about.html", "about\n"); git(seed, "add", "."); git(seed, "commit", "-qm", "v2");
  git(seed, "remote", "add", "origin", origin); git(seed, "push", "-q", "origin", "main");
  const head = git(seed, "rev-parse", "HEAD");

  // ── one folder, two drive-letter spellings (Windows): c:\… from workspaceFolders, C:\… from os.homedir ──
  if (/^[a-z]:/i.test(tmp)) {
    const lower = tmp[0].toLowerCase() + tmp.slice(1), upper = tmp[0].toUpperCase() + tmp.slice(1);
    assert.equal(canonicalizeExistingPath(lower), canonicalizeExistingPath(upper), "drive-letter case must not split one folder");
    assert.equal(canonicalizeExistingPath(path.join(lower, "not-yet", "x.html")), canonicalizeExistingPath(path.join(upper, "not-yet", "x.html")));
    assert.notEqual(canonicalizeExistingPath(path.join(tmp, "a")), canonicalizeExistingPath(path.join(tmp, "b")), "control: different folders stay different");
    ok("path identity: c:\ and C:\ name one folder (existing and not-yet-existing paths)");
  }

  // ── sameRepoUrl ──
  assert.ok(sameRepoUrl("https://github.com/Student01/dental-homepage.git\n", "student01", "Dental-Homepage"));
  assert.ok(sameRepoUrl("git@github.com:Student01/dental-homepage", "Student01", "dental-homepage"));
  assert.ok(!sameRepoUrl("https://github.com/Student01/dental-homepage-2.git", "Student01", "dental-homepage"), "control: a longer name is another repository");
  assert.ok(!sameRepoUrl("https://github.com/someone/dental-homepage.git", "Student01", "dental-homepage"), "control: another owner");
  ok("remote URL names the repository (https/ssh, case-insensitive); other names and owners do not");

  // ── locateRepoFolder ──
  const classRoot = path.join(tmp, "HypeProofDentalSeminar");
  const login = "Student01", repo = "dental-homepage", sibling = `${classRoot}-${repo}`;
  assert.deepEqual(await locateRepoFolder({ exec, login, repo, classRoot }), { folder: sibling, present: false });
  fs.mkdirSync(sibling); write(sibling, "index.html", "old\n");
  assert.deepEqual(await locateRepoFolder({ exec, login, repo, classRoot }), { folder: sibling, present: true }, "a plain copy beside the class folder is the repository's");
  execFileSync("git", ["init", "-q", sibling]); git(sibling, "remote", "add", "origin", "https://github.com/someone-else/other.git");
  assert.deepEqual(await locateRepoFolder({ exec, login, repo, classRoot }), { folder: `${sibling}-2`, present: false }, "control: a clone of another repository is left alone");
  git(sibling, "remote", "set-url", "origin", `https://github.com/${login}/${repo}.git`);
  assert.deepEqual(await locateRepoFolder({ exec, login, repo, classRoot }), { folder: sibling, present: true });
  const registered = path.join(tmp, "elsewhere"); fs.mkdirSync(registered);
  assert.deepEqual(await locateRepoFolder({ exec, login, repo, classRoot, registered }), { folder: registered, present: true }, "the registered folder wins");
  ok("folder lookup: registered → <class>-<repo> → next free name; a foreign clone is skipped");

  // ── syncClone: a plain folder becomes a clone; "open" keeps the files ──
  const plain = path.join(tmp, "plain"); fs.mkdirSync(plain); write(plain, "index.html", "local work\n"); write(plain, ".coach-note", "keep\n");
  let r = await syncClone({ exec, gh: "gh", login, repo, branch: "main", folder: plain, replace: false, remoteUrl: origin });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(git(plain, "rev-parse", "HEAD"), head);
  assert.equal(git(plain, "rev-parse", "--abbrev-ref", "@{u}"), "origin/main");
  assert.equal(read(plain, "index.html"), "local work\n", "open keeps the participant's files");
  assert.equal(read(plain, ".coach-note"), "keep\n");
  assert.equal(git(plain, "config", "core.autocrlf"), "false");
  assert.match(git(plain, "status", "--porcelain"), /M index\.html/, "the local work shows as a change on top of GitHub's head");
  ok("open: plain folder becomes a clone at GitHub's head, files and dot entries untouched, autocrlf off");

  // ── syncClone: "pull" replaces the files, backup first ──
  const stale = path.join(tmp, "stale"); fs.mkdirSync(stale); write(stale, "index.html", "unpublished\n");
  const backup = `${stale}.before-pull-x`;
  r = await syncClone({ exec, gh: "gh", login, repo, branch: "main", folder: stale, replace: true, backup, remoteUrl: origin });
  assert.ok(r.ok && r.backup === backup, JSON.stringify(r));
  assert.equal(read(stale, "index.html"), "v2\n");
  assert.equal(read(stale, "about.html"), "about\n");
  assert.equal(read(backup, "index.html"), "unpublished\n", "the replaced work survives in the backup");
  assert.equal(git(stale, "status", "--porcelain"), "");
  ok("pull: files become GitHub's, a backup holds what was there");

  // Run again on the same clone (the second press): still fine, nothing duplicated.
  r = await syncClone({ exec, gh: "gh", login, repo, branch: "main", folder: stale, replace: true, remoteUrl: origin });
  assert.ok(r.ok && !r.backup);
  assert.equal(git(stale, "rev-parse", "HEAD"), head);
  ok("a second sync on an existing clone is a no-op move");

  // ── failures ──
  const unreachable = path.join(tmp, "unreachable"); fs.mkdirSync(unreachable);
  r = await syncClone({ exec, gh: "gh", login, repo, branch: "main", folder: unreachable, replace: false, remoteUrl: path.join(tmp, "missing.git") });
  assert.equal(r.ok, false); assert.equal(r.code, "fetch");
  const target = path.join(tmp, "clone-fail");
  const failingGh = async () => { fs.mkdirSync(target); return { ok: false, missing: false, stdout: "", stderr: "fatal: repository not found" }; };
  r = await cloneRepo({ exec: failingGh, gh: "gh", login, repo, branch: "main", folder: target });
  assert.equal(r.code, "clone"); assert.ok(!fs.existsSync(target), "a failed clone leaves no folder");
  const noGit = async () => ({ ok: false, missing: false, stdout: "", stderr: 'exec: "git": executable file not found in %PATH%' });
  assert.equal((await cloneRepo({ exec: noGit, gh: "gh", login, repo, branch: "main", folder: target })).code, "git_missing");
  // macOS without Command Line Tools: /usr/bin/git is a stub that answers through xcrun.
  const macStub = async () => ({ ok: false, missing: false, stdout: "", stderr: "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun" });
  assert.equal((await cloneRepo({ exec: macStub, gh: "gh", login, repo, branch: "main", folder: target })).code, "git_missing");
  ok("failures: unreachable remote → fetch; failed clone cleaned up; missing git named as such");

  // The clone call itself: the argument vector gh receives.
  let seen;
  await cloneRepo({ exec: async (f, a) => { seen = [f, ...a]; return { ok: true, missing: false, stdout: "", stderr: "" }; }, gh: "C:\\gh\\gh.exe", login, repo, branch: "main", folder: target });
  assert.deepEqual(seen, ["C:\\gh\\gh.exe", "repo", "clone", `${login}/${repo}`, target, "--", "--quiet", "--branch", "main", "--config", "core.autocrlf=false"]);
  ok("clone runs `gh repo clone <login>/<repo> <folder>` with autocrlf off");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
