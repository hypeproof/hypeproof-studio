// Windows in-app update: the staged installer's file name and the wrapper that runs it.
// Run: node --experimental-strip-types test/update-windows-installer.smoke.mjs
//
// Regression for v2026.1109.0 -> v2026.1115.0 (2026-11-16): since #1585 `downloadUrl` is the REST
// asset URL (.../releases/assets/<id>), so the staged installer was named after the numeric id
// ("749161648", no .exe) and the PowerShell wrapper could not launch it. Studio quit and stayed on
// the old version.
//
// Pure checks only, so they run in every smoke shard. Executing the wrapper (mocked and, on a Windows
// runner, against harmless stub executables) is test/update-windows-wrapper.smoke.mjs.

import assert from "node:assert/strict";
import path from "node:path";

const {
  parseLatestRelease, pickWindowsInstaller, safeInstallerFileName, windowsInstallerFileName, renderWindowsUpdateWrapper,
} = await import("../src/updateCheckerHelpers.ts");

// A release payload shaped like GET /repos/<org>/<repo>/releases/latest (only the fields the updater reads).
const NAME = "HypeProof.StudioUserSetup-x64-1.116.04919.exe";
const release = {
  tag_name: "v2026.1115.0", name: "v2026.1115.0", body: "notes", prerelease: false, draft: false,
  html_url: "https://github.com/hypeproof/hypeproof-studio-releases/releases/tag/v2026.1115.0",
  assets: [
    { id: 749161647, name: "HypeProof-Studio-darwin-arm64.zip", size: 1, digest: "sha256:" + "a".repeat(64),
      url: "https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/749161647",
      browser_download_url: "https://github.com/hypeproof/hypeproof-studio-releases/releases/download/v2026.1115.0/HypeProof-Studio-darwin-arm64.zip" },
    { id: 749161648, name: NAME, size: 126 * 1024 * 1024, digest: "sha256:" + "b".repeat(64),
      url: "https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/749161648",
      browser_download_url: `https://github.com/hypeproof/hypeproof-studio-releases/releases/download/v2026.1115.0/${NAME}` },
  ],
};

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`PASS ${label}`); } catch (error) { failed++; console.log(`FAIL ${label}\n  ${error?.stack ?? error}`); }
};

await check("regression: the REST asset URL basename is the numeric id, and the installer is still named *.exe", () => {
  const info = parseLatestRelease(release, "2026.1109.0", pickWindowsInstaller);
  assert.equal(info.available, true);
  assert.equal(path.posix.basename(new URL(info.downloadUrl).pathname), "749161648", "premise: the URL basename has no extension");
  assert.equal(info.assetName, NAME, "the update info carries the asset's real name");
  assert.equal(windowsInstallerFileName(info), NAME);
  assert.match(windowsInstallerFileName(info), /\.exe$/);
});

await check("a missing or unsafe asset name falls back to the versioned name", () => {
  const fallback = "HypeProofStudioSetup-2026.1115.0.exe";
  assert.equal(windowsInstallerFileName({ version: "2026.1115.0" }), fallback);
  assert.equal(windowsInstallerFileName({ assetName: "749161648", version: "2026.1115.0" }), fallback, "numeric id");
  assert.equal(windowsInstallerFileName({ assetName: "setup.zip", version: "2026.1115.0" }), fallback, "wrong extension");
  assert.equal(windowsInstallerFileName({ assetName: NAME, version: "../x\\y" }), NAME);
  assert.equal(windowsInstallerFileName({ version: "../x\\y" }), "HypeProofStudioSetup-.._x_y.exe", "the version cannot add a path");
});

await check("hostile asset names are never used as a file name", () => {
  const hostile = [
    "..\\..\\Startup\\evil.exe", "../../evil.exe", "C:\\Windows\\evil.exe", "dir/evil.exe", "dir\\evil.exe",
    "evil.exe\u0000.txt", "ev\nil.exe", "ev\til.exe", "evil\u202Efdp.exe", "evil.exe ", "evil.exe.", ".exe", "..exe",
    "a..b.exe", "con.exe", "NUL.exe", "COM1.exe", "lpt9.exe", "ev:il.exe", "ev*il.exe", "ev?il.exe", 'ev"il.exe',
    "ev<il>.exe", "ev|il.exe", "", " ", "x".repeat(130) + ".exe", "setup.exe:stream", "setup.exe\u007f", 42, null, undefined, {},
  ];
  for (const name of hostile) {
    assert.equal(safeInstallerFileName(name), "", `rejected: ${JSON.stringify(name)}`);
    assert.match(windowsInstallerFileName({ assetName: name, version: "1.2.3" }), /^HypeProofStudioSetup-1\.2\.3\.exe$/);
  }
  for (const ok of [NAME, "HypeProof.StudioSetup-x64-1.116.04919.exe", "Setup (1).EXE", "스튜디오-Setup.exe"]) {
    assert.equal(safeInstallerFileName(ok), ok, `accepted: ${ok}`);
  }
});

const render = (extra = {}) => renderWindowsUpdateWrapper({
  appProcessName: "HypeProof Studio", installerPath: "C:\\Temp\\hps-update-1\\" + NAME, installerArgs: ["/silent", "/mergetasks=runcode"],
  appExePath: "C:\\Users\\u\\AppData\\Local\\Programs\\HypeProof Studio\\HypeProof Studio.exe", failureLogPath: "C:\\Temp\\hps-update-failure.log", ...extra,
});

await check("rendered wrapper: refuses a non-.exe or missing installer, records the failure and relaunches the app", () => {
  const s = render();
  const at = (text) => { const i = s.indexOf(text); assert.ok(i >= 0, `missing: ${text}`); return i; };
  assert.ok(at("Get-Process -Name $name") < at("Start-Process -PassThru"), "still waits for the app to exit first");
  assert.ok(at("-notmatch '\\.exe$'") < at("Start-Process -PassThru"), "extension check precedes the launch");
  assert.ok(at("Test-Path -LiteralPath $installer -PathType Leaf") < at("Start-Process -PassThru"), "existence check precedes the launch");
  assert.ok(at("$setup.ExitCode -ne 0") > at("$setup.WaitForExit()"), "a failed Setup is detected after it exits");
  assert.ok(at("} catch {\r\n") > at("$setup.ExitCode"), "failures are caught");
  const recovery = s.slice(at("} catch {\r\n"));
  assert.ok(recovery.includes("Write-UpdateLog ('update failed"), "failure is recorded");
  assert.ok(recovery.includes("Start-Process -FilePath $appExe"), "the existing app is relaunched");
  assert.ok(recovery.includes("exit 1"), "the wrapper reports failure");
  assert.ok(s.includes("$appExe = 'C:\\Users\\u\\AppData\\Local\\Programs\\HypeProof Studio\\HypeProof Studio.exe'"));
  assert.ok(s.includes("$failLog = 'C:\\Temp\\hps-update-failure.log'"));
  assert.ok(s.startsWith("\uFEFF"), "BOM kept");
  assert.ok(s.includes(`$installer = 'C:\\Temp\\hps-update-1\\${NAME}'`));
});

await check("rendered wrapper without an app path logs but does not try to relaunch", () => {
  const s = render({ appExePath: undefined, failureLogPath: undefined });
  assert.ok(s.includes("$appExe = ''") && s.includes("$failLog = ''"));
});

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log("PASS update-windows-installer");
