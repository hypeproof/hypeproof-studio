// General browsing must not create or serve a workspace artifact (#1762).
// Offline contract tests: no model, Service, native window, or network calls.
import assert from "node:assert/strict";
import {
  BROWSER_OPEN_TOOL_DEF,
  buildHypeproofMcpServer,
  MCP_BROWSER_OPEN,
  runBrowserOpen,
  runLivePreviewStart,
} from "../src/browserMcp.ts";
import { evaluateSdkToolUse } from "../src/sdkCoachHelpers.ts";
import { originOfUrl, safeNavigateUrl } from "../src/browserControlHelpers.ts";

function browserHost(overrides = {}) {
  const calls = { opened: [], previews: 0 };
  return {
    calls,
    host: {
      openBrowser: async url => { calls.opened.push(url); },
      screenshot: async () => null,
      startLivePreview: async () => { calls.previews++; return "http://127.0.0.1:50123/"; },
      livePreviewUrl: async () => null,
      ...overrides,
    },
  };
}

// A missing destination means a native blank browser, with no workspace side effects.
{
  const { host, calls } = browserHost();
  const result = await runBrowserOpen(host, undefined);
  assert.equal(result.isError, undefined, "opening a browser must not require an invented URL");
  assert.deepEqual(calls, { opened: ["about:blank"], previews: 0 });
  assert.match(result.content[0].text, /브라우저/);
}

const { isGeneralBrowserOpenRequest } = await import("../src/browserIntent.ts");

// Bound only the complete, explicit open-browser request; do not infer authoring intent.
{
  for (const text of ["웹브라우저를 열어줘봐 옆에", "웹브라우저를 열어줘바 옆에", "브라우저 열어", "옆에 브라우저 좀 열어줘", "오른쪽에 웹 브라우저를 열어 주세요", "브라우저 창 띄워줘", "Open a browser on the right", "Please open the web browser"]) {
    assert.equal(isGeneralBrowserOpenRequest(text), true, text);
  }
  for (const text of ["내 웹사이트를 브라우저에서 미리 보여줘", "브라우저 옆에 웹사이트 만들어줘", "브라우저에서 https://example.com 열어줘", "localhost:3000을 브라우저로 열어줘", "브라우저를 열지 마", "브라우저 열어줘. 그리고 홈페이지도 만들어줘", "index.html 미리보기 열어줘", "Don't open a browser", "내 사이트를 만든 다음 브라우저를 열어줘"]) {
    assert.equal(isGeneralBrowserOpenRequest(text), false, text);
  }
  const { host, calls } = browserHost({ generalBrowserRequest: true });
  const wrongTool = await runLivePreviewStart(host);
  assert.equal(wrongTool.isError, true);
  assert.match(wrongTool.content[0].text, /browser_open/);
  for (const invented of ["http://localhost:3000", "file:///tmp/index.html", "https://example.com"]) {
    assert.equal((await runBrowserOpen(host, invented)).isError, true, invented);
  }
  assert.deepEqual(calls, { opened: [], previews: 0 });
  assert.equal((await runBrowserOpen(host, undefined)).isError, undefined);
  assert.deepEqual(calls, { opened: ["about:blank"], previews: 0 });
  const authored = browserHost();
  assert.equal((await runLivePreviewStart(authored.host)).isError, undefined);
  assert.deepEqual(authored.calls, { opened: [], previews: 1 }, "authored preview keeps its existing live-server route");
}

// Both tool admission and execution keep grants, hostile schemes, and CR restrictions.
{
  const evaluate = (input, granted = true) => evaluateSdkToolUse({
    toolName: MCP_BROWSER_OPEN, input,
    permittedTools: granted ? [MCP_BROWSER_OPEN] : [], workspaceRoot: "/fixture/workspace",
  });
  assert.equal(evaluate({}).decision, "ask", "the existing open-browser approval policy still applies");
  assert.equal(evaluate({}, false).decision, "deny", "no browser capability is gained by omitting the URL");
  assert.equal(originOfUrl("about:blank"), null, "blank-page approval must not authorize file/null origins");
  assert.equal(safeNavigateUrl("about:blank"), "about:blank");
  for (const url of ["", null, {}, "about:config", "about:blank#payload", "javascript:alert(1)", "data:text/html,hi", "vscode://settings"]) {
    const { host, calls } = browserHost();
    assert.equal((await runBrowserOpen(host, url)).isError, true, JSON.stringify(url));
    assert.equal(evaluate({ url }).decision, "deny", JSON.stringify(url));
    assert.deepEqual(calls, { opened: [], previews: 0 });
  }
  const restricted = browserHost({ crEnabled: () => true, crScope: () => ({ ok: false, reason: "Only the permitted preview is available." }) });
  assert.equal((await runBrowserOpen(restricted.host, undefined)).isError, true);
  assert.deepEqual(restricted.calls, { opened: [], previews: 0 });
}

// The model-facing SDK and local definitions expose the same optional destination.
{
  const registered = [];
  const { host, calls } = browserHost();
  const factory = {
    tool: (name, description, inputSchema, handler) => { const tool = { name, description, inputSchema, handler }; registered.push(tool); return tool; },
    createSdkMcpServer: options => options,
  };
  const string = { optional: () => ({ optionalString: true }) };
  buildHypeproofMcpServer(factory, { string: () => string }, host);
  const tool = registered.find(t => t.name === "browser_open");
  assert.deepEqual(tool.inputSchema.url, { optionalString: true });
  assert.deepEqual(BROWSER_OPEN_TOOL_DEF.inputSchema.required, []);
  assert.equal((await tool.handler({}, {})).isError, undefined);
  assert.deepEqual(calls, { opened: ["about:blank"], previews: 0 });
}

console.log("✓ browser intent: blank browsing, wrong-preview guard, capability/URL boundaries, shared tool schema");
