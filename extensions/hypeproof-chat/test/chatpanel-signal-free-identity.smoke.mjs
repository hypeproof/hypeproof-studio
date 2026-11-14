// #4092 — without the rehearsal signal, the whole ChatPanel render is byte-identical to main's. The expected digest was
// recorded from origin/main with RECORD=1 (same fixture, same normalisation, TZ=UTC). A rehearsal band that moves back to
// a sibling of the main render shifts React's useId values and changes this digest; that is the planted defect.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";
import { chatPanelProps } from "./sx-screen-fixtures.mjs";

const RECORD = process.env.RECORD === "1";
process.env.TZ = "UTC";

// Expected for origin/main (recorded with RECORD=1 in a worktree of origin/main, 2026-11-14).
const EXPECTED = "30789eb22060cf8c229396d82b8aa28c0e32ade1fed6487d11df39d76f29ac89";

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const webviewDir = new URL("../webview-ui/", import.meta.url);
const webviewRequire = createRequire(new URL("package.json", webviewDir));
const nodeRequire = createRequire(import.meta.url);

async function renderChatPanel(props) {
  const entry = [
    `import { createElement } from "react";`,
    `import { renderToStaticMarkup } from "react-dom/server";`,
    `import { ChatPanel } from "./src/ChatPanel.tsx";`,
    `export function render(props) { return renderToStaticMarkup(createElement(ChatPanel, props)); }`,
  ].join("\n");
  for (const id of ["react", "react-dom/server"]) webviewRequire.resolve(id);
  const bundle = await build({
    stdin: { contents: entry, resolveDir: webviewDir.pathname, loader: "tsx", sourcefile: "chatpanel-identity-entry.tsx" },
    bundle: true, platform: "node", format: "cjs", jsx: "automatic",
    loader: { ".css": "text", ".svg": "text", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' }, write: false, logLevel: "silent",
  });
  const windowStub = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: nodeRequire, console, process, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
    TextEncoder, TextDecoder, URL, window: windowStub, self: windowStub,
  });
  return module.exports.render(props);
}

// The same normalisation the orchestrator gate applies to attachment and undo live regions.
const withoutEmptyRecovery = (html) => html
  .replaceAll('<div class="hps-attachment-failures" aria-label="다시 확인할 첨부 파일"></div>', "")
  .replace('<p class="hps-attachment-error-summary" role="status" aria-live="polite" aria-atomic="true" data-testid="attachment-error-summary"></p>', "")
  .replace('<div class="hps-undo-toast" role="status" aria-live="polite" aria-atomic="true" data-testid="undo-toast" data-shown="false"></div>', "");

// No rehearsal signal: the fixture has no `rehearsalSeat` key at all, as the host sends it on a normal student seat.
const props = chatPanelProps();
assert.equal("rehearsalSeat" in (props.config ?? {}), false, "the fixture carries no rehearsal signal");
const digest = sha(withoutEmptyRecovery(await renderChatPanel(props)));

if (RECORD) {
  console.log(`RECORDED ${digest}`);
  process.exit(0);
}
assert.equal(digest, EXPECTED, "ChatPanel without the rehearsal signal renders differently from main");
console.log("✓ ChatPanel without the rehearsal signal is byte-identical to main");
