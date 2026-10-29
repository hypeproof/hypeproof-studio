// #3221 — the coach's page_pdf_save: PDF of a work-folder HTML page with Studio's own browser, so the coach never runs
// Chrome's binary (macOS denied App Management to Studio on 2026-10-29). Granted with the browser capability, allowed
// without a modal like a preview, refused without the grant; the app-bundle refusal points to it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_BROWSER_TOOLS, MCP_PAGE_PDF_SAVE, PAGE_PDF_SAVE_TOOL_DEF, runPagePdfSave } from "../src/browserMcp.ts";
import { evaluateSdkToolUse, APP_BUNDLE_PROGRAM_REASON } from "../src/sdkCoachHelpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
assert.equal(MCP_PAGE_PDF_SAVE, "mcp__hypeproof__page_pdf_save");
assert.ok(MCP_BROWSER_TOOLS.includes(MCP_PAGE_PDF_SAVE), "granted with the browser capability");
assert.match(PAGE_PDF_SAVE_TOOL_DEF.description, /Chrome/); assert.match(PAGE_PDF_SAVE_TOOL_DEF.description, /PDF가 필요하면 이 도구만 쓴다/);
assert.deepEqual(PAGE_PDF_SAVE_TOOL_DEF.inputSchema.required, ["path"]);

// Handler: the host's result goes back as the tool result; bad input and an old host are refused.
const calls = [];
const host = { savePagePdf: async (p) => { calls.push(p); return p === "report-src.htm" ? { ok: true, text: "PDF로 저장했어요: report-src.pdf" } : { ok: false, text: "HTML 파일만 PDF로 저장할 수 있어요." }; } };
assert.deepEqual(await runPagePdfSave(host, { path: " report-src.htm " }), { content: [{ type: "text", text: "PDF로 저장했어요: report-src.pdf" }] });
assert.equal((await runPagePdfSave(host, { path: "notes.md" })).isError, true);
for (const bad of [{}, { path: "" }, { path: 7 }, { path: "x".repeat(301) }]) assert.equal((await runPagePdfSave(host, bad)).isError, true, JSON.stringify(bad));
assert.deepEqual(calls, ["report-src.htm", "notes.md"], "malformed input never reaches the host");
assert.equal((await runPagePdfSave({}, { path: "a.html" })).isError, true, "a host without the method says so");

// Policy: allowed when granted (like live_preview_start), refused as not granted otherwise.
const gate = (permitted) => evaluateSdkToolUse({ toolName: MCP_PAGE_PDF_SAVE, input: { path: "report-src.htm" }, permittedTools: permitted, workspaceRoot: "/w", canonicalize: (p) => p, audience: "solo" });
assert.deepEqual(gate([...MCP_BROWSER_TOOLS]), { decision: "allow" });
assert.equal(gate(["Bash"]).decision, "deny");

// The app-bundle refusal points the coach to it.
assert.match(APP_BUNDLE_PROGRAM_REASON, /PDF로 저장'\(page_pdf_save\)/);
const v = evaluateSdkToolUse({ toolName: "Bash", input: { command: '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --print-to-pdf=a.pdf a.html' }, permittedTools: ["Bash"], workspaceRoot: "/w", canonicalize: (p) => p, audience: "solo" });
assert.equal(v.decision, "deny"); assert.ok(v.friendly.includes("page_pdf_save"));

// Wiring: the provider's browser host resolves the path against the work folder and reuses savePagePdf.
const src = fs.readFileSync(path.join(here, "../src/chatPanelProvider.ts"), "utf8");
assert.match(src, /savePagePdf: async \(rel: string\) => \{\s*\n[^\n]*resolveCoachCwd\(\)[^\n]*\n[^\n]*\n\s*return this\.savePagePdf\(vscode\.Uri\.file\(path\.resolve\(workRoot, rel\)\)\);/);
console.log("page-pdf-tool: ok");
