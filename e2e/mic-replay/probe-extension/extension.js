// Test-only extension for e2e/mic-replay. Loaded with --extensionDevelopmentPath into a
// throwaway profile, never shipped. Two jobs:
//   1. own a webview VIEW and a webview PANEL under a foreign extension id. The view has
//      the same purpose ('webviewView') as the chat view, so a denial here isolates the
//      extension-id key of the microphone patch.
//   2. run VS Code commands for the harness: it writes req-N.json into
//      the `hpsMicProbe.dir` setting, this extension executes it and writes res-N.json.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const html = label => `<!doctype html><html><head><meta charset="utf-8"><title>${label}</title></head><body>${label}</body></html>`;

async function run(req) {
  if (req.op === "command") {
    const args = (req.args || []).map(a => (a && a.$uri ? vscode.Uri.file(a.$uri) : a));
    const r = await vscode.commands.executeCommand(req.command, ...args);
    return r === undefined ? null : String(r);
  }
  if (req.op === "open") {
    await vscode.window.showTextDocument(vscode.Uri.file(req.path), { preview: false });
    return null;
  }
  if (req.op === "probePanel") {
    const p = vscode.window.createWebviewPanel("hpsMicProbe.panel", "mic probe panel", vscode.ViewColumn.One, { enableScripts: true });
    p.webview.html = html("hps-mic-probe-panel");
    return null;
  }
  if (req.op === "closeEditors") {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    return null;
  }
  throw new Error(`unknown op ${req.op}`);
}

exports.activate = context => {
  // The harness passes the channel directory as a setting: env does not reliably reach the
  // extension host.
  const dir = vscode.workspace.getConfiguration("hpsMicProbe").get("dir") || process.env.HPS_MIC_PROBE_DIR;
  if (!dir) return;
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("hpsMicProbe.view", {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true };
      view.webview.html = html("hps-mic-probe-view");
    },
  }));
  let n = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const file = path.join(dir, `req-${n}.json`);
    if (fs.existsSync(file)) {
      let res;
      try {
        res = { ok: true, value: await run(JSON.parse(fs.readFileSync(file, "utf8"))) };
      } catch (e) {
        res = { ok: false, error: String((e && e.message) || e) };
      }
      fs.writeFileSync(path.join(dir, `res-${n}.json`), JSON.stringify(res));
      n++;
    }
    setTimeout(tick, 100);
  };
  context.subscriptions.push({ dispose: () => { stopped = true; } });
  fs.writeFileSync(path.join(dir, "ready.json"), JSON.stringify({ pid: process.pid }));
  tick();
};
exports.deactivate = () => {};
