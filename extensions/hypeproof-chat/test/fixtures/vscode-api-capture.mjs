// A stand-in for the webview's acquireVsCodeApi that records every postToHost message in
// globalThis.__hpsPosted. Import it first in a bundled render test, before any webview module:
// webview-ui/src/vscode.ts reads window.acquireVsCodeApi once, when it is first evaluated.
globalThis.window = globalThis.window ?? {};
globalThis.__hpsPosted = [];
globalThis.window.acquireVsCodeApi = () => ({
  postMessage: (msg) => { globalThis.__hpsPosted.push(msg); },
  getState: () => undefined,
  setState: () => {},
});
