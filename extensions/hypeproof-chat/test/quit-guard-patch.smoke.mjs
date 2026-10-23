// REQ-STUDIO-QUIT-GUARD — the core patch that ships the quit guard.
// 1. The committed patch is exactly what the generator builds from the canonical sources and
//    the pristine upstream files (so the tested modules are the shipped modules).
// 2. It applies to the pristine upstream files and adds the canonical sources byte for byte.
// 3. stage-core-patches.sh puts it where prepare_vscode.sh applies user patches.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const coreDir = path.join(repo, "scripts/patches/core");
const patch = path.join(coreDir, "hps-quit-guard.patch");
const upstream = path.join(coreDir, "upstream");
const canonical = path.join(coreDir, "src");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-quit-guard-patch-"));
try {
  // A stand-in VS Code checkout: the pristine upstream files committed at HEAD.
  const tree = path.join(tmp, "vscode");
  fs.cpSync(path.join(upstream, "src"), path.join(tree, "src"), { recursive: true });
  run("git", ["init", "-q"], tree);
  run("git", ["add", "-A"], tree);
  run("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", "upstream"], tree);

  // 1. Not stale.
  assert.match(run("python3", [path.join(coreDir, "build_quit_guard_patch.py"), tree, "--check"], repo), /is current/);

  // 2. Applies, and the added files are the canonical sources.
  run("git", ["apply", "--check", patch], tree);
  run("git", ["apply", patch], tree);
  const added = files(canonical);
  assert.equal(added.length, 3);
  for (const rel of added) {
    assert.equal(fs.readFileSync(path.join(tree, "src", rel), "utf8"), fs.readFileSync(path.join(canonical, rel), "utf8"), rel);
  }
  // The hooks: the safe-default branch is the first statement of massageMessageBoxOptions, and
  // the desktop workbench loads the contribution.
  const dialogs = fs.readFileSync(path.join(tree, "src/vs/platform/dialogs/common/dialogs.ts"), "utf8");
  const body = dialogs.split("export function massageMessageBoxOptions(")[1].split("\n").slice(1, 4).join("\n");
  assert.equal(body, "\tif (hpsIsSafeDefaultDialog(options)) {\n\t\treturn hpsMassageSafeDefaultDialog(options, productService.nameLong, button => mnemonicButtonLabel(button).withMnemonic);\n\t}");
  const main = fs.readFileSync(path.join(tree, "src/vs/workbench/workbench.desktop.main.ts"), "utf8");
  assert.ok(main.includes("import './contrib/hpsQuitGuard/electron-browser/hpsQuitGuard.contribution.js';\n"));
  // Nothing else in the upstream files changed.
  assert.equal(run("git", ["diff", "--numstat"], tree).trim().split("\n").map((l) => l.split("\t").slice(0, 2).join("/")).join(","), "5/0,2/1,3/0"); // dialogs.ts: import + 3-line branch + blank; main: blank + comment + import

  // 3. Staging copies every core patch into patches/user/ under a 99- prefix.
  const fake = path.join(tmp, "studio");
  fs.mkdirSync(path.join(fake, "scripts/patches/core"), { recursive: true });
  fs.copyFileSync(path.join(repo, "scripts/stage-core-patches.sh"), path.join(fake, "scripts/stage-core-patches.sh"));
  fs.copyFileSync(patch, path.join(fake, "scripts/patches/core/hps-quit-guard.patch"));
  run("bash", [path.join(fake, "scripts/stage-core-patches.sh")], fake);
  run("bash", [path.join(fake, "scripts/stage-core-patches.sh")], fake);
  assert.deepEqual(fs.readdirSync(path.join(fake, "vscodium-base/patches/user")), ["99-hps-quit-guard.patch"]);
  assert.equal(fs.readFileSync(path.join(fake, "vscodium-base/patches/user/99-hps-quit-guard.patch"), "utf8"), fs.readFileSync(patch, "utf8"));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("quit guard core patch: current, applies to pristine 1.116, ships the tested sources, staged as a user patch PASS");
