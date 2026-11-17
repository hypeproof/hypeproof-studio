// CGP-KNOW-R-011 (REQ-KNOW-20) — opening a 내 작품 row. The resolver against real temp folders (listed files only,
// the canonical check run again at open time), then the real ChatPanelProvider (bundled with a scripted `vscode`):
// an HTML page opens in Studio's preview, an allowlisted image in the built-in image preview, anything else in the
// default text editor (`vscode.openWith(uri, "default")`, never `vscode.open`, so no custom editor or notebook), never
// the OS default app (`vscode.env.openExternal`); the list is bound to its seat; a refusal posts the one drawer line.
//   node --experimental-strip-types test/my-works-open.smoke.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const { resolveMyWorksFile, myWorksOpenVia, MY_WORKS_OPEN_REFUSED, MY_WORKS_EDITOR } = await import("../src/myWorksOpen.ts");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hp-my-works-open-"));
const root = path.join(tmp, "work"), outside = path.join(tmp, "outside");
fs.mkdirSync(path.join(root, "pages"), { recursive: true }); fs.mkdirSync(outside);
const write = (rel, text = "x") => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
write("index.html", "<h1>hi</h1>"); write("pages/about.htm", "<p>a</p>"); write("notes.md", "# n"); write("images/cat.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
write("data.bin", Buffer.from([0, 1, 2, 3, 255])); write("later.txt", "t"); write("hard.txt", "h");
write("lab.ipynb", '{"cells":[{"cell_type":"code","outputs":[{"output_type":"display_data","data":{"text/html":"<script>alert(1)</script>"}}]}]}');
write("team.code-workspace", '{"folders":[{"path":"/"}]}'); write("ext.vsix", Buffer.from([0x50, 0x4b, 3, 4, 0, 0])); write("icon.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
fs.writeFileSync(path.join(outside, "secret.txt"), "s");
fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
fs.symlinkSync(outside, path.join(root, "linkdir"));
fs.linkSync(path.join(root, "hard.txt"), path.join(outside, "hard-twin.txt"));
fs.mkdirSync(path.join(root, "folder"));
const listed = new Set(["lab.ipynb", "team.code-workspace", "ext.vsix", "icon.svg", "a:b.txt", "notes.md:stream", "trail.", "trail ", "dir./x.txt", "dir /x.txt", "index.html", "pages/about.htm", "notes.md", "images/cat.png", "data.bin", "later.txt", "hard.txt", "link.txt", "linkdir/secret.txt", "folder", "gone.txt",
  "../outside/secret.txt", "/etc/passwd", "a//b", "./notes.md", "notes\\md", "no\u0007tes.md"]);

try {
  // 1. Listed, canonical files open; HTML in the preview, everything else in an editor tab.
  for (const [rel, via] of [["index.html", "preview"], ["pages/about.htm", "preview"], ["notes.md", "text"], ["images/cat.png", "image"], ["data.bin", "text"],
    ["lab.ipynb", "text"], ["team.code-workspace", "text"], ["ext.vsix", "text"], ["icon.svg", "image"]]) {
    const r = resolveMyWorksFile(root, rel, listed);
    ok(r.ok && r.via === via && r.absPath === path.join(fs.realpathSync(root), ...rel.split("/")), `opens: ${rel} via ${via}`);
  }
  ok(myWorksOpenVia("A.HTML") === "preview" && myWorksOpenVia("a.html.txt") === "text", "only .html/.htm go to the preview");
  ok(["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg"].every((f) => myWorksOpenVia(f) === "image") && ["a.bmp", "b.ico", "c.tiff", "d.png.exe"].every((f) => myWorksOpenVia(f) === "text"), "only allowlisted images go to the image preview");
  ok(MY_WORKS_EDITOR.text === "default" && MY_WORKS_EDITOR.image === "imagePreview.previewEditor", "the editor ids: the default text editor, the built-in image preview");
  // 2. Refusals.
  const refused = (rel, why, set = listed) => ok(resolveMyWorksFile(root, rel, set).ok === false, `refused (${why}): ${JSON.stringify(rel)}`);
  refused("notes.md", "not in the inventory", new Set(["index.html"]));
  refused("link.txt", "a link to a file outside");
  refused("linkdir/secret.txt", "a linked folder on the way");
  refused("hard.txt", "a hard link (second name for a file that may live outside)");
  refused("folder", "a folder");
  refused("gone.txt", "removed since the list");
  for (const rel of ["../outside/secret.txt", "/etc/passwd", "a//b", "./notes.md", "notes\\md", "no\u0007tes.md", "", 42, null]) refused(rel, "malformed");
  // Windows names (verify-r027): a colon (alternate data stream or drive) anywhere in a segment; a trailing dot or space.
  for (const rel of ["a:b.txt", "notes.md:stream", "trail.", "trail ", "dir./x.txt", "dir /x.txt"]) refused(rel, "a Windows name that is not the checked file");
  ok(resolveMyWorksFile(undefined, "notes.md", listed).ok === false, "no work folder: refused");
  // 3. TOCTOU: the inventory listed a real file; it was replaced by a link afterwards. The check runs at open time.
  fs.rmSync(path.join(root, "later.txt")); fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "later.txt"));
  refused("later.txt", "replaced by a link after the list");

  // 4. The real provider: only the listed paths of the current work folder, and only Studio's own views.
  const require = createRequire(import.meta.url);
  const bundle = await build({ entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent" });
  const commands = [], external = [], posted = [];
  const vscode = {
    env: { appName: "HypeProof Studio", openExternal: async (u) => { external.push(String(u)); return true; }, clipboard: { writeText: async () => {} } },
    Uri: { parse: (s) => ({ scheme: "x", s }), file: (p) => ({ scheme: "file", fsPath: p }) }, ViewColumn: { Beside: -2, One: 1, Two: 2 }, ConfigurationTarget: { Global: 1 },
    commands: { executeCommand: async (id, ...args) => { commands.push([id, ...args]); } },
    window: { showInformationMessage: async () => {}, showWarningMessage: async () => {} },
    workspace: { getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }) },
  };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout,
    setInterval, clearInterval, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto, Response, structuredClone,
    fetch: async () => new Response("{}", { status: 503 }),
  });
  const h = Object.create(mod.exports.ChatPanelProvider.prototype);
  const seat = { store: {}, cwd: root, key: "activity-1|profile-a" };
  const fields = {
    post: async (m) => { posted.push(m); return true; }, _instructorMode: { isInstructor: false, reset() {} },
    currentTaskStore: () => seat.store, resolveCoachCwd: () => seat.cwd, worksSeat: () => seat.key,
    provenanceRecorder: () => ({ generation: () => 0, view: async () => ({ entries: ["index.html", "notes.md", "data.bin", "link.txt", "images/cat.png", "icon.svg", "lab.ipynb", "team.code-workspace", "ext.vsix"].map((p) => ({ path: p })), more: 0 }) }),
    hasActiveStream: () => false, pendingSends: 0,
  };
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(h, key, { value, writable: true, configurable: true });
  const open = async (p, id = "r1") => { posted.length = 0; commands.length = 0; await h.openMyWorksFile({ type: "myWorksOpen", requestId: id, path: p }); return posted.at(-1); };
  ok((await open("notes.md")).ok === false && commands.length === 0, "nothing opens before a list was shown");
  await h.postArtifactProvenance(false);
  let r = await open("index.html");
  ok(r.ok === true && commands.length === 1 && commands[0][0] === "hypeproof-chat.previewActiveFile" && commands[0][1].fsPath.endsWith(`${path.sep}index.html`), "an HTML page opens in Studio's preview");
  // Never vscode.open (a custom editor or a notebook renderer could take the file): openWith with a fixed editor id.
  for (const [p, editor, why] of [["notes.md", "default", "text"], ["data.bin", "default", "binary: the text editor's binary notice"], ["lab.ipynb", "default", "a notebook as text: no outputs or scripts rendered"],
    ["team.code-workspace", "default", "a workspace file as text: no Open Workspace flow"], ["ext.vsix", "default", "a .vsix as binary text, never installed"],
    ["images/cat.png", "imagePreview.previewEditor", "an image in the built-in preview"], ["icon.svg", "imagePreview.previewEditor", "an SVG as an image (its scripts do not run)"]]) {
    r = await open(p);
    ok(r.ok === true && commands.length === 1 && commands[0][0] === "vscode.openWith" && commands[0][1].scheme === "file" && commands[0][2] === editor, `${p}: openWith "${editor}" (${why})`);
  }
  ok(!commands.some(([id]) => id === "vscode.open"), "vscode.open is never used");
  for (const [p, why] of [["link.txt", "a link"], ["pages/about.htm", "not in the last list"], ["../outside/secret.txt", "traversal"]]) {
    r = await open(p);
    ok(r.ok === false && r.error === MY_WORKS_OPEN_REFUSED && commands.length === 0, `the provider refuses (${why}) with the one line`);
  }
  ok(external.length === 0, "never the OS default app or an external browser");
  seat.cwd = outside;
  r = await open("index.html");
  ok(r.ok === false && commands.length === 0, "a list from another work folder opens nothing");
  // The list is bound to its seat: after a seat change it opens nothing until a new list is shown.
  seat.cwd = root; seat.key = "activity-2|profile-b";
  r = await open("index.html");
  ok(r.ok === false && commands.length === 0, "a list from another seat opens nothing");
  await h.postArtifactProvenance(false);
  r = await open("index.html");
  ok(r.ok === true && commands.length === 1, "a fresh list for the new seat opens again");
  // An identity change (here the personal account's secret) drops the list, even on the same activity and profile;
  // an unrelated secret leaves it.
  h.noteWorksIdentityChange("hypeproof.unrelated.secret");
  ok((await open("index.html")).ok === true, "an unrelated secret change keeps the list");
  h.noteWorksIdentityChange("hypeproofChat.personalAccount.v1");
  r = await open("index.html");
  ok(r.ok === false && commands.length === 0, "an account change drops the list: nothing opens until a new list");
  await h.postArtifactProvenance(false);
  ok((await open("index.html")).ok === true, "a fresh list after the change opens again");
  Object.defineProperty(h, "_instructorMode", { value: { isInstructor: true, reset() {} }, writable: true, configurable: true });
  r = await open("index.html");
  ok(r.ok === false && commands.length === 0, "an instructor seat (no task workspace) opens nothing");
  posted.length = 0;
  await h.openMyWorksFile({ type: "myWorksOpen", requestId: "bad id!", path: "index.html" });
  ok(posted.length === 0, "a malformed request id is dropped");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`PASS my works open: ${checks} checks (listed files only, checked at open time; HTML in the preview, the rest in an editor tab; never the OS app)`);
