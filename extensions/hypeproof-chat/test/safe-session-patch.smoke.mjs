// REQ-N11 (2026-11-05) — the persist:hp-safe core patch, ported from the vscodium fork branch
// feat/306-hp-safe-session into Studio's own core patches.
// 1. It applies to the pristine VS Code 1.116 files (scripts/patches/core/upstream) and changes only them.
// 2. Default off: the view uses the hardened session only when `hypeproof.browser.hardenedSessionEnabled`
//    (default false) AND the extension's `safeSession` are true; all three settings are application-scoped.
// 3. Every top-level load (not only renderer navigations) meets the allowlist.
// 4. The shipped URL matcher, extracted from the patched file and run here, agrees with the chat
//    extension's `hostAllowed` on http(s) URLs, keeps local pages and refuses look-alikes.
// 5. stage-core-patches.sh stages it as a 99- user patch.
//   node --experimental-strip-types test/safe-session-patch.smoke.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { hostAllowed } = await import("../src/browserSafetyHelpers.ts");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const coreDir = path.join(repo, "scripts/patches/core");
const patch = path.join(coreDir, "hps-safe-session.patch");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const FILES = [
  "src/vs/platform/browserView/common/browserView.ts",
  "src/vs/platform/browserView/electron-main/browserSession.ts",
  "src/vs/platform/browserView/electron-main/browserView.ts",
  "src/vs/platform/browserView/electron-main/browserViewMainService.ts",
  "src/vs/workbench/contrib/browserView/common/browserView.ts",
  "src/vs/workbench/contrib/browserView/electron-browser/browserView.contribution.ts",
  "src/vs/workbench/contrib/browserView/electron-browser/browserViewActions.ts",
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-safe-session-patch-"));
try {
  // 1. A stand-in VS Code checkout with the pristine upstream files at HEAD.
  const tree = path.join(tmp, "vscode");
  for (const rel of FILES) {
    fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
    fs.copyFileSync(path.join(coreDir, "upstream", rel), path.join(tree, rel));
  }
  run("git", ["init", "-q"], tree);
  run("git", ["add", "-A"], tree);
  run("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", "upstream"], tree);
  const text = fs.readFileSync(patch, "utf8");
  assert.deepEqual([...text.matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]), FILES, "the patch edits exactly the seven browserView files");
  run("git", ["apply", "--check", "--ignore-whitespace", patch], tree); // prepare_vscode.sh's apply_patch flags
  run("git", ["apply", patch], tree);
  const read = (rel) => fs.readFileSync(path.join(tree, rel), "utf8");

  // 2. Default off, application-scoped.
  const model = read(FILES[4]);
  // The gate (flag AND minor seat, REQ-N11 lock included) lives in hpSafeSessionOptions; browser-settings-lock.smoke.mjs runs it.
  assert.match(model, /const on = \(configurationService\.getValue<boolean>\('hypeproof\.browser\.hardenedSessionEnabled'\) === true \|\| lock\?\.hardened === true\)\n\t\t&& \(configurationService\.getValue<boolean>\('hypeproof\.browser\.safeSession'\) === true \|\| lock\?\.safeSession === true\);/, "the gate: flag AND minor seat");
  assert.match(model, /const safe = hpSafeSessionOptions\(this\.configurationService, this\.storageService\);/, "off → no safe options, upstream call unchanged");
  const contribution = read(FILES[5]);
  for (const key of ["hardenedSessionEnabled", "safeSession", "safeAllowlist"]) {
    const block = contribution.split(`'hypeproof.browser.${key}': {`)[1]?.split("\n\t\t}")[0] ?? "";
    assert.match(block, /scope: ConfigurationScope\.APPLICATION,/, `${key} is application-scoped (no workspace override)`);
    assert.match(block, key === "safeAllowlist" ? /default: \[\],/ : /default: false,/, `${key} defaults off/empty`);
  }
  assert.match(contribution, /import \{ ConfigurationScope, IConfigurationRegistry, Extensions as ConfigurationExtensions \} from '..\/..\/..\/..\/platform\/configuration\/common\/configurationRegistry\.js';/);

  // 3. Hardening on the session and the contents.
  const session = read(FILES[1]);
  assert.match(session, /if \(this\.sessionKind === 'safe'\) \{[\s\S]{0,700}setPermissionRequestHandler\(\(_webContents, _permission, callback\) => callback\(false\)\);[\s\S]{0,200}setPermissionCheckHandler\(\(\) => false\);[\s\S]{0,200}'will-download', \(event\) => event\.preventDefault\(\)/, "deny-all permissions and downloads");
  assert.match(session, /webRequest\.onBeforeRequest\(\(details, callback\) => \{\n\t\t\t\tcallback\(\{ cancel: details\.resourceType === 'mainFrame' && !this\.isUrlAllowed\(details\.url\) \}\);/, "main-process loads (loadURL, CDP) meet the allowlist");
  assert.match(session, /static getOrCreateSafe\(allowlist: readonly string\[\] = \[\]\): BrowserSession \{\n\t\tconst electronSession = session\.fromPartition\('persist:hp-safe'\);/);
  const view = read(FILES[2]);
  assert.match(view, /if \(this\.session\.sessionKind === 'safe'\) \{\n\t\t\t\treturn \{ action: 'deny' \};/, "no popups");
  assert.match(view, /webContents\.on\('will-navigate', guardNavigation\);\n\t\t\tthis\._view\.webContents\.on\('will-redirect', guardNavigation\);/);
  assert.match(view, /toggleDevTools\(\): void \{\n\t\t\/\/ HypeProof #306 — devtools stay disabled for minor cohorts\.\n\t\tif \(this\.session\.sessionKind === 'safe'\) \{\n\t\t\treturn;/);
  // Non-safe sessions keep upstream's permission policy byte for byte.
  assert.match(session, /\} else \{\n\t\t\tthis\.electronSession\.setPermissionRequestHandler\(\(_webContents, permission, callback\) => \{\n\t\t\t\treturn callback\(allowedPermissions\.has\(permission\)\);/);

  // 4. The shipped matcher, run as shipped.
  const fn = session.slice(session.indexOf("export function hpsSafeUrlAllowed("));
  assert.ok(fn.startsWith("export function hpsSafeUrlAllowed(url: string, allowlist: readonly string[]): boolean {"));
  const modFile = path.join(tmp, "matcher.ts");
  fs.writeFileSync(modFile, fn);
  const { hpsSafeUrlAllowed } = await import(pathToFileURL(modFile).href);
  const list = ["example.org", "*.school.example", ".kids.example", "https://docs.example.net/guide", "https://hypeproof-ai.xyz/live/x/gallery", " HTTPS://Upper.Example/ ", "", "https://", "exa mple.org", "/example.org", 42];
  const URLS = [
    // admitted
    "https://example.org/", "http://www.example.org/x", "https://a.b.school.example/", "https://kids.example/a", "https://docs.example.net/guide",
    "https://docs.example.net/guide/page", "https://hypeproof-ai.xyz/live/x/gallery/abc?room=1", "https://EXAMPLE.ORG./x", "https://upper.example/any/path",
    // refused
    "https://evilexample.org/", "https://example.org.evil.com/", "https://docs.example.net/guidebook", "http://docs.example.net/guide",
    "https://docs.example.net/", "https://example.org@evil.com/", "https://games.example.com/", "https://hypeproof-ai.xyz/live/y/",
    "http://localhost.evil.com/", "http://127.0.0.1.nip.io/",
  ];
  for (const u of URLS) assert.equal(hpsSafeUrlAllowed(u, list), hostAllowed(new URL(u), list), `parity with the extension: ${u}`);
  assert.equal(URLS.filter((u) => hpsSafeUrlAllowed(u, list)).length, 9, "nine admitted, ten refused (controls)");
  // Local pages always open; other schemes and junk never do; an empty list confines to local pages.
  for (const u of ["file:///Users/learner/site/index.html", "about:blank", "http://localhost:5500/", "http://127.0.0.1:3000/", "http://[::1]:8080/", "http://2130706433/"]) {
    assert.equal(hpsSafeUrlAllowed(u, []), true, u);
  }
  for (const u of ["javascript:alert(1)", "data:text/html,<h1>x</h1>", "blob:https://example.org/1", "mailto:a@example.org", "not a url", "https://example.org/"]) {
    assert.equal(hpsSafeUrlAllowed(u, []), false, u);
  }

  // 5. Staging.
  const fake = path.join(tmp, "studio");
  fs.mkdirSync(path.join(fake, "scripts/patches/core"), { recursive: true });
  fs.copyFileSync(path.join(repo, "scripts/stage-core-patches.sh"), path.join(fake, "scripts/stage-core-patches.sh"));
  fs.copyFileSync(patch, path.join(fake, "scripts/patches/core/hps-safe-session.patch"));
  run("bash", [path.join(fake, "scripts/stage-core-patches.sh")], fake);
  assert.deepEqual(fs.readdirSync(path.join(fake, "vscodium-base/patches/user")), ["99-hps-safe-session.patch"]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// The chat extension's side: no settings write without a served profile (the keys are registered now).
const provider = fs.readFileSync(path.join(repo, "extensions/hypeproof-chat/src/chatPanelProvider.ts"), "utf8");
assert.match(provider, /private async applyBrowserSafety\(profile: ResolvedProfile \| null\): Promise<void> \{\n    if \(profile\) \{/, "a failed fetch keeps the last served values");
// REQ-N11 (2026-11-07): the extension writes hardenedSessionEnabled only through the settings lock, whose value is the
// served `browser_session.hardened` or the registered default (off): never on by itself before the real-device check.
assert.doesNotMatch(provider, /update\("hardenedSessionEnabled"/, "no direct write of the flag");
const { browserSettingsLockFrom } = await import("../src/browserSafetyHelpers.ts");
assert.equal(browserSettingsLockFrom({ minor_cohort: true, browser_session: { mode: "safe", allowlist: ["a.example"] } }, false, 1).hardened, false, "not served: stays off");

console.log("safe-session core patch: applies to pristine 1.116, default off, application-scoped, every top-level load checked, matcher matches the extension, staged PASS");
