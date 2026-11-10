// #3640 — the Dev app keeps the SDK coach's CLI config under its own state, not in the real home.
//
// Invariants, one file:
//   1. Release behavior is unchanged: a release app name (and an undefined root) yields exactly the home/APPDATA path.
//   2. A Dev app name yields <globalStorage>/claude-config, and the seat rule is appended to it.
//   3. A path with spaces (…/Application Support/…) is passed through unchanged.
//   4. The provider really passes devSdkConfigRoot(...) into runSdkCoach (source check).
//
// Run: node --experimental-strip-types test/dev-sdk-config-root.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { devSdkConfigRoot, sdkConfigDirFor } = await import("../src/sdkCoachHelpers.ts");

const GS = "/Users/dev/Library/Application Support/HypeProof-Studio-Dev/User/globalStorage/hypeproof.hypeproof-chat";
const SEAT = "seat-abc";

// 1. Release: the name test is false, so the root is undefined and the path is unchanged.
for (const name of ["HypeProof Studio", "Visual Studio Code", "HypeProof Studio Dev "]) {
  assert.equal(devSdkConfigRoot(name, GS), undefined, `release/other name ${JSON.stringify(name)} gets no root`);
}
{
  const home = { HOME: "/Users/student" };
  const before = sdkConfigDirFor(home, SEAT);
  const after = sdkConfigDirFor(home, SEAT, devSdkConfigRoot("HypeProof Studio", GS));
  assert.equal(after, before, "release HOME path is identical to the previous result");
  assert.ok(before.startsWith("/Users/student/.hypeproof-studio/"), "release HOME path is the home folder");
}
{
  const appData = { APPDATA: "C:/Users/s/AppData/Roaming" };
  const before = sdkConfigDirFor(appData, SEAT);
  const after = sdkConfigDirFor(appData, SEAT, devSdkConfigRoot("HypeProof Studio", GS));
  assert.equal(after, before, "release APPDATA path is identical to the previous result");
  assert.ok(before.startsWith("C:/Users/s/AppData/Roaming/HypeProof-Studio/"), "release APPDATA path is the APPDATA folder");
}
assert.equal(sdkConfigDirFor({ HOME: "/Users/student" }, SEAT, undefined), sdkConfigDirFor({ HOME: "/Users/student" }, SEAT), "undefined root is the default path");
console.log("ok release: no root for release/other names; HOME and APPDATA paths unchanged");

// 2. Dev: the root is <globalStorage>/claude-config, and the seat is appended under it.
assert.equal(devSdkConfigRoot("HypeProof Studio Dev", "/gs"), "/gs/claude-config", "Dev name yields <globalStorage>/claude-config");
assert.equal(sdkConfigDirFor({ HOME: "/Users/student" }, SEAT, devSdkConfigRoot("HypeProof Studio Dev", "/gs")), `/gs/claude-config/${SEAT}`, "Dev seat folder under the Dev root");
assert.equal(sdkConfigDirFor({ HOME: "/Users/student" }, undefined, devSdkConfigRoot("HypeProof Studio Dev", "/gs")), "/gs/claude-config", "Dev without a seat is the root itself");
assert.equal(devSdkConfigRoot("HypeProof Studio Dev", "   "), undefined, "an empty global storage path gives no root");
assert.equal(devSdkConfigRoot("HypeProof Studio Dev", ""), undefined, "Dev name with an empty path gives undefined, never a relative folder");
console.log("ok dev: positive control yields the Dev root and the seat folder under it");

// 3. Spaces in the path are passed through unchanged (no escaping, no trimming inside).
{
  const root = devSdkConfigRoot("HypeProof Studio Dev", GS);
  const dir = sdkConfigDirFor({ HOME: "/Users/student" }, SEAT, root);
  assert.equal(dir, `${GS}/claude-config/${SEAT}`, "space-containing global storage path is kept verbatim");
  assert.ok(dir.includes("Application Support/HypeProof-Studio-Dev"), "the spaced folder name survives");
}
console.log("ok spaces: a path containing Application Support is passed through unchanged");

// 4. The provider passes the root into runSdkCoach (the release path gets undefined from the same call).
{
  const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(provider, /sdkConfigRoot: devSdkConfigRoot\(vscode\.env\.appName, this\.context\.globalStorageUri\?\.fsPath \?\? ''\),/, "provider passes devSdkConfigRoot into runSdkCoach");
  const sdk = readFileSync(new URL("../src/sdkCoach.ts", import.meta.url), "utf8");
  assert.match(sdk, /sdkConfigDirFor\(process\.env, coachSeatKeyFor\(args\), args\.sdkConfigRoot\)/, "runSdkCoach hands its root to sdkConfigDirFor");
}
console.log("ok wiring: provider -> runSdkCoach -> sdkConfigDirFor");
console.log("all dev-sdk-config-root checks passed");
