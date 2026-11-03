// DEC-03 — who may request the microphone. Source-level scope lock for the core patch.
//
// The microphone reaches a webview only through `vscodium-base/patches/user/
// 60-webview-allow-microphone.patch` (v4, fork 59e5792). It opens three gates:
//
//   app.ts            'media' in the Electron webview permission set
//   webviewElement.ts outer iframe allow += microphone   (workbench -> webview shell)
//   pre/index.html    inner iframe allow += microphone   (shell -> content)
//
// and keys BOTH iframe levels on two values ANDed: the owning extension id
// `hypeproof.hypeproof-chat` and `purpose === 'webviewView'`. The second key is the
// one that matters, and it is only as narrow as this extension keeps it: every
// webview VIEW this extension contributes inherits the grant, every webview PANEL
// (start page, preview, nine panels in all) does not. The patch header names that
// residual; nothing enforced it. This file does:
//
//   A. the extension contributes exactly ONE webview view and registers exactly ONE
//      WebviewViewProvider, for that view; its id is the one the patch keys on.
//      Adding a second view fails here, so the grant can't widen silently.
//   B. the patch's microphone delegations are each guarded by both keys, there are
//      exactly two (one per iframe level), 'media' sits in the webview set, and no
//      other device feature is delegated.
//
// B reads the submodule. pr-ci does not check submodules out, so there B's real-patch
// row prints NOT RUN and only its synthetic controls run. Point HPS_VSCODIUM_SRC at a
// vscodium checkout to run it anywhere.
//
// What this cannot prove (needs the built app on a real Mac): that the OS prompt
// appears, that the mic indicator turns on and off, that getUserMedia returns a live
// track, and that the start page and preview measure allowsFeature('microphone') false.
//
// Run: node --experimental-strip-types test/mic-delegation-scope.smoke.mjs

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, "..");
const repoRoot = join(extRoot, "..", "..");

const MIC_EXTENSION_ID = "hypeproof.hypeproof-chat";
const MIC_VIEW_ID = "hypeproof-chat.panel";
const PATCH_SUBPATH = join("patches", "user", "60-webview-allow-microphone.patch");
const PATCH_FILES = [
  "src/vs/code/electron-main/app.ts",
  "src/vs/workbench/contrib/webview/browser/pre/index.html",
  "src/vs/workbench/contrib/webview/browser/webviewElement.ts",
];
const OTHER_DEVICE_FEATURES = ["camera", "display-capture", "geolocation", "speaker-selection"];

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/.*$/gm, "$1");

// ─── A. the extension's webview-view surface ───

function webviewViewSurface(pkg, sources) {
  const problems = [];
  const id = `${pkg.publisher}.${pkg.name}`.toLowerCase();
  if (id !== MIC_EXTENSION_ID) problems.push(`extension id is ${id}, the patch keys on ${MIC_EXTENSION_ID}`);
  const views = Object.values(pkg.contributes?.views ?? {}).flat();
  const webviewViews = views.filter((v) => v.type === "webview").map((v) => v.id);
  if (webviewViews.length !== 1 || webviewViews[0] !== MIC_VIEW_ID) {
    problems.push(`contributed webview views are [${webviewViews.join(", ")}], expected only ${MIC_VIEW_ID}`);
  }
  const registered = [];
  for (const [file, src] of sources) {
    for (const m of stripComments(src).matchAll(/registerWebviewViewProvider\s*\(\s*(["'`])([^"'`]+)\1/g)) {
      registered.push(`${m[2]} (${file})`);
    }
    if (/registerWebviewViewProvider\s*\(\s*[^"'`\s]/.test(stripComments(src))) {
      registered.push(`<non-literal id> (${file})`);
    }
  }
  if (registered.length !== 1 || !registered[0].startsWith(`${MIC_VIEW_ID} `)) {
    problems.push(`registerWebviewViewProvider calls: [${registered.join(", ")}], expected exactly one for ${MIC_VIEW_ID}`);
  }
  return problems;
}

function listTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const realPkg = JSON.parse(readFileSync(join(extRoot, "package.json"), "utf8"));
const realSources = listTs(join(extRoot, "src")).map((p) => [p.slice(extRoot.length + 1), readFileSync(p, "utf8")]);

assert.deepEqual(webviewViewSurface(realPkg, realSources), [], "A: the shipped extension has one webview view");
console.log(`  ✓ A real: ${MIC_EXTENSION_ID} contributes and registers exactly one webview view (${MIC_VIEW_ID})`);

// A, negative controls: each widening must be caught.
{
  const twoViews = structuredClone(realPkg);
  const [container] = Object.keys(twoViews.contributes.views);
  twoViews.contributes.views[container].push({ id: "hypeproof-chat.voice", name: "voice", type: "webview" });
  assert.notDeepEqual(webviewViewSurface(twoViews, realSources), [], "a second contributed webview view must fail");

  const twoProviders = [...realSources, ["src/voiceView.ts", 'vscode.window.registerWebviewViewProvider("hypeproof-chat.voice", p);']];
  assert.notDeepEqual(webviewViewSurface(realPkg, twoProviders), [], "a second registered provider must fail");

  const dynamicId = [...realSources, ["src/voiceView.ts", "vscode.window.registerWebviewViewProvider(viewId, p);"]];
  assert.notDeepEqual(webviewViewSurface(realPkg, dynamicId), [], "a provider with a computed id must fail");

  const commentedOnly = [["src/a.ts", '// registerWebviewViewProvider("hypeproof-chat.panel", p)']];
  assert.notDeepEqual(webviewViewSurface(realPkg, commentedOnly), [], "a call that exists only in a comment must not count");

  const renamed = { ...realPkg, publisher: "someone-else" };
  assert.notDeepEqual(webviewViewSurface(renamed, realSources), [], "an id the patch does not key on must fail");
  console.log("  ✓ A controls: second view, second provider, computed id, comment-only call, renamed id all fail");
}

// ─── B. the patch's delegations ───

// Post-image of every hunk per file (context + added lines, removed lines dropped).
function patchPostImage(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) { current = header[1]; files.set(current, []); continue; }
    if (!current || line.startsWith("--- ") || line.startsWith("@@")) {
      if (line.startsWith("@@") && current) files.get(current).push("/* hunk */");
      continue;
    }
    if (line.startsWith("+")) files.get(current).push(line.slice(1));
    else if (line.startsWith(" ")) files.get(current).push(line.slice(1));
  }
  return new Map([...files].map(([k, v]) => [k, v.join("\n")]));
}

function addedCode(text) {
  return stripComments(text.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n"));
}

const BOTH_KEYS_OUTER = /if\s*\(\s*this\.extension\?\.id\.value\.toLowerCase\(\)\s*===\s*'hypeproof\.hypeproof-chat'\s*&&\s*options\.purpose\s*===\s*'webviewView'\s*\)\s*\{\s*allowRules\.push\('microphone'\);\s*\}/;
const BOTH_KEYS_INNER_DEF = /const\s+hpsMicrophoneAllowed\s*=\s*searchParams\.get\('extensionId'\)\s*===\s*'hypeproof\.hypeproof-chat'\s*&&\s*searchParams\.get\('purpose'\)\s*===\s*'webviewView'\s*;/;
const BOTH_KEYS_INNER_USE = /if\s*\(\s*hpsMicrophoneAllowed\s*\)\s*\{\s*allowRules\.push\('microphone;'\);\s*\}/;

function micDelegationProblems(patchText) {
  const problems = [];
  const post = patchPostImage(patchText);
  const touched = [...post.keys()].sort();
  if (JSON.stringify(touched) !== JSON.stringify([...PATCH_FILES].sort())) {
    problems.push(`patch touches [${touched.join(", ")}], expected [${PATCH_FILES.join(", ")}]`);
  }
  const added = addedCode(patchText);
  const pushes = added.match(/allowRules\.push\(\s*'microphone;?'\s*\)/g) ?? [];
  if (pushes.length !== 2) problems.push(`${pushes.length} microphone delegations added, expected 2 (one per iframe level)`);
  for (const f of OTHER_DEVICE_FEATURES) {
    if (new RegExp(`['"]${f};?['"]`).test(added)) problems.push(`patch also delegates ${f}`);
  }

  const outer = stripComments(post.get(PATCH_FILES[2]) ?? "");
  if (!BOTH_KEYS_OUTER.test(outer)) problems.push("outer delegation (webviewElement.ts) is not guarded by extension id AND purpose === 'webviewView'");

  const inner = stripComments(post.get(PATCH_FILES[1]) ?? "");
  if (!BOTH_KEYS_INNER_DEF.test(inner)) problems.push("inner key (pre/index.html) is not extensionId AND purpose === 'webviewView'");
  if (!BOTH_KEYS_INNER_USE.test(inner)) problems.push("inner delegation (pre/index.html) is not guarded by hpsMicrophoneAllowed");

  const app = stripComments(post.get(PATCH_FILES[0]) ?? "");
  // The real hunk's context ends before the set's closing `])`, so stop at the hunk end too.
  const webviewSet = /allowedPermissionsInWebview\s*=\s*new Set\(\[([\s\S]*?)(?:\]\)|\/\* hunk \*\/|$)/.exec(app);
  if (!webviewSet || !/'media'/.test(webviewSet[1])) problems.push("'media' is not in allowedPermissionsInWebview");
  if (!/^\+\s*'media',\s*$/m.test(patchText)) problems.push("'media' is not an added line (the hunk no longer adds it)");
  return problems;
}

// A minimal v4-shaped patch, so the positive control runs where the submodule is absent.
const V4_FIXTURE = `--- a/src/vs/code/electron-main/app.ts
+++ b/src/vs/code/electron-main/app.ts
@@ -194,6 +194,7 @@
 		const allowedPermissionsInWebview = new Set([
 			...alwaysAllowedPermissions,
+			'media',
 			'clipboard-read',
 		]);
--- a/src/vs/workbench/contrib/webview/browser/pre/index.html
+++ b/src/vs/workbench/contrib/webview/browser/pre/index.html
@@ -33,6 +33,8 @@
 		const onElectron = searchParams.get('platform') === 'electron';
+		const hpsMicrophoneAllowed = searchParams.get('extensionId') === 'hypeproof.hypeproof-chat'
+			&& searchParams.get('purpose') === 'webviewView';
@@ -1056,6 +1063,9 @@
 					allowRules.push('clipboard-read;', 'clipboard-write;');
+					if (hpsMicrophoneAllowed) {
+						allowRules.push('microphone;');
+					}
 				}
--- a/src/vs/workbench/contrib/webview/browser/webviewElement.ts
+++ b/src/vs/workbench/contrib/webview/browser/webviewElement.ts
@@ -408,6 +408,10 @@
 		}
+		if (this.extension?.id.value.toLowerCase() === 'hypeproof.hypeproof-chat'
+			&& options.purpose === 'webviewView') {
+			allowRules.push('microphone');
+		}
 		element.setAttribute('allow', allowRules.join('; '));
`;

assert.deepEqual(micDelegationProblems(V4_FIXTURE), [], "B positive control: the v4 shape passes");
console.log("  ✓ B positive control: a v4-shaped patch passes");

// B, negative controls: each is a real past or plausible regression.
{
  const v3IdOnly = V4_FIXTURE
    .replace("\n+\t\t\t&& options.purpose === 'webviewView') {", ") {")
    .replace("\n+\t\t\t&& searchParams.get('purpose') === 'webviewView';", ";");
  assert.notDeepEqual(micDelegationProblems(v3IdOnly), [], "v3 (extension id only, admitted three webviews) must fail");

  const orKeys = V4_FIXTURE.replace("\t&& options.purpose", "\t|| options.purpose");
  assert.notDeepEqual(micDelegationProblems(orKeys), [], "keys ORed instead of ANDed must fail");

  const unguarded = V4_FIXTURE.replace("+\t\t\t\t\tif (hpsMicrophoneAllowed) {\n+\t\t\t\t\t\tallowRules.push('microphone;');\n+\t\t\t\t\t}", "+\t\t\t\t\t\tallowRules.push('microphone;');");
  assert.notDeepEqual(micDelegationProblems(unguarded), [], "an unguarded inner push (v2-style, every webview) must fail");

  const commentedGuard = V4_FIXTURE.replace("+\t\tif (this.extension", "+\t\t// if (this.extension");
  assert.notDeepEqual(micDelegationProblems(commentedGuard), [], "a guard that exists only in a comment must fail");

  const noMedia = V4_FIXTURE.replace("+\t\t\t'media',\n", "");
  assert.notDeepEqual(micDelegationProblems(noMedia), [], "dropping 'media' from the webview set must fail");

  const plusCamera = V4_FIXTURE.replace("+\t\t\tallowRules.push('microphone');", "+\t\t\tallowRules.push('microphone');\n+\t\t\tallowRules.push('camera');");
  assert.notDeepEqual(micDelegationProblems(plusCamera), [], "delegating camera too must fail");

  const thirdLevel = V4_FIXTURE + `--- a/src/vs/workbench/contrib/webview/browser/webview.ts
+++ b/src/vs/workbench/contrib/webview/browser/webview.ts
@@ -1,1 +1,2 @@
+allowRules.push('microphone');
`;
  assert.notDeepEqual(micDelegationProblems(thirdLevel), [], "a delegation in a third file must fail");
  console.log("  ✓ B controls: v3 id-only, ORed keys, unguarded push, comment-only guard, no media, + camera, third file all fail");
}

const vscodiumRoot = process.env.HPS_VSCODIUM_SRC || join(repoRoot, "vscodium-base");
const realPatch = join(vscodiumRoot, PATCH_SUBPATH);
if (existsSync(realPatch)) {
  assert.deepEqual(micDelegationProblems(readFileSync(realPatch, "utf8")), [], `B real: ${realPatch}`);
  console.log(`  ✓ B real: ${PATCH_SUBPATH} delegates microphone to the chat view only (two levels + media)`);
} else {
  console.log(`  - B real: NOT RUN — ${realPatch} absent (submodule not checked out; set HPS_VSCODIUM_SRC)`);
}

console.log("mic-delegation-scope: ok");
