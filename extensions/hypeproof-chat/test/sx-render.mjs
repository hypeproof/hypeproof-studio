// Render instrument — renders the real webview components to static HTML and hands back the
// **rendered text**.
//
// Why we render instead of reading the source (.claude/rules/verification.md rule 1):
//   Judge the claim "the screen has no forbidden string" by grepping the source and you miss
//   every conditionally rendered branch, every assembled template, every constant reference.
//   Open **the subject of the verdict (the render output)** before setting the criterion.
//   The acceptance criterion in docs/plan/ux-dag.yaml P0-B says the same:
//   "The instrument reads real component render output, not a copy of the strings".
//
// How:
//   The same idiom as test/clear-history.smoke.mjs · test/start-page.smoke.mjs — build one
//   bundle with esbuild and run it under vm.runInNewContext. The only difference is that
//   resolveDir is webview-ui, because react / react-dom / react/jsx-runtime live there.
//
// Where react is missing:
//   CI installs the webview's dependencies before the smoke tests (.github/workflows/pr-ci.yml,
//   `extension / smoke` job, step "Install webview deps (the render instrument needs react)"),
//   so the render checks run there. A checkout without webview-ui/node_modules has no react:
//   rendererStatus() then returns reason:"webview-deps-missing" and the caller skips while
//   **surfacing** that fact (a NOT RUN line). It does not silently pass. The pure text
//   controls and the empty-region guard (auditRegionText's empty_region) run either way.

import vm from "node:vm";
import { build } from "esbuild";
import { createRequire } from "node:module";

const here = new URL("./", import.meta.url);
const webviewDir = new URL("../webview-ui/", here);
const nodeRequire = createRequire(import.meta.url);
const webviewRequire = createRequire(new URL("package.json", webviewDir));

/** The real components we can render. Paths are relative to webview-ui. */
export const COMPONENTS = {
  // Renders as-is without the host bridge: useEffect does not run under SSR, and
  // src/vscode.ts only looks at `window.acquireVsCodeApi` at module top level
  // (given the window stub it falls through to undefined).
  NativeObservationPanel: { from: "./src/NativeObservationPanel.tsx", exportName: "NativeObservationPanel" },
  // Region A (SX-01~05). Renders without the host bridge — callbacks are injected as props
  // and it does not touch the vscode API at module top level.
  MissionHeader: { from: "./src/MissionHeader.tsx", exportName: "MissionHeader" },
  // The work screen itself (the coach rail) and the entry screen. This is what C1 means by
  // "the screen during work" — the 2026-09-20 review flagged it as "the auditor does not
  // actually render the work screen". Both render without the host bridge: `src/vscode.ts`
  // only **reads** `window.acquireVsCodeApi` at module top level (undefined given the window
  // stub), and useEffect does not run under SSR.
  ChatPanel: { from: "./src/ChatPanel.tsx", exportName: "ChatPanel" },
  StartPage: { from: "./src/StartPage.tsx", exportName: "StartPage" },
  // Region D (SX-17~24). Lives on props alone — it draws the `learningState.evidence` the
  // host sent, and does not recompute the gate.
  EvidenceDrawer: { from: "./src/EvidenceDrawer.tsx", exportName: "EvidenceDrawer" },
  // Region D's completion line (SX-14 gate, SX-55 phase). Props only — it draws the
  // `learningState` the host sent; ChatPanel's hook that holds that state never fills under SSR.
  CompletionGate: { from: "./src/CompletionGate.tsx", exportName: "CompletionGate" },
  // The local review's line for the curriculum task records its list leaves out (MC-27), with
  // its delete button (MC-31). Props only; LocalReview's own state never fills under SSR.
  OmittedRecords: { from: "./src/LocalReview.tsx", exportName: "OmittedRecords" },
  // cr-verify — "내 제품 테스트" (CR-12–CR-16, CR-81). Lives on props alone: it draws the
  // VerifyView the host computed and never decides "검증됨" itself.
  VerifyPanel: { from: "./src/VerifyPanel.tsx", exportName: "VerifyPanel" },
  PublishPanel: { from: "./src/PublishPanel.tsx", exportName: "PublishPanel" },
  // cr-evidence (#1394) — the experiment evidence panel.
  EvidencePanel: { from: "./src/EvidencePanel.tsx", exportName: "EvidencePanel" },
  // cr-memory (#1395) — the Venture Memory panel; draws the MemoryView the host read.
  MemoryPanel: { from: "./src/MemoryPanel.tsx", exportName: "MemoryPanel" },
  // cr-skills (#1396) — the curriculum skills panel; draws the SkillsView the host read.
  SkillsPanel: { from: "./src/SkillsPanel.tsx", exportName: "SkillsPanel" },
  // cr-review (#1398) — the Weekly Review panel, the student's and the director's; draws the ReviewView the host read.
  ReviewPanel: { from: "./src/ReviewPanel.tsx", exportName: "ReviewPanel" },
  // AE-01 (#554) — the learner's goal block (closed, as it renders first) and its editor (drawn only while the block is
  // open, which a server render never is). Both live on props: the goal the host sent, this view's note, the fields.
  StudentGoal: { from: "./src/StudentGoal.tsx", exportName: "StudentGoal" },
  GoalEditor: { from: "./src/StudentGoal.tsx", exportName: "GoalEditor" },
  // REQ-L12 ⑫ (ot-conversation-carryover) — the trial carry-over offer and read-only transcript.
  TrialCarryover: { from: "./src/TrialCarryover.tsx", exportName: "TrialCarryover" },
};

/**
 * Whether react / react-dom are installed under webview-ui. We resolve rather than guess.
 *
 * Why `resolve` is left injectable: so the CI path (a root without react) can be reproduced
 * **through this function itself**. If we never check that a skip really happens for the
 * reason it claims, the skip turns into a silent pass (rule 4).
 */
export function rendererStatus(resolve = (id) => webviewRequire.resolve(id)) {
  for (const id of ["react", "react/jsx-runtime", "react-dom/server"]) {
    try {
      resolve(id);
    } catch (error) {
      return {
        available: false,
        reason: "webview-deps-missing",
        detail: `${id} 를 webview-ui 에서 resolve 하지 못했다: ${error.message}`,
      };
    }
  }
  return { available: true, reason: null, detail: `webview-ui/node_modules 에서 react 를 찾았다` };
}

let compiled = null;

async function loadBundle() {
  if (compiled) return compiled;
  const status = rendererStatus();
  if (!status.available) throw new Error(`렌더 계측기를 쓸 수 없다 — ${status.detail}`);

  const entry = [
    `import { createElement } from "react";`,
    `import { renderToStaticMarkup } from "react-dom/server";`,
    ...Object.entries(COMPONENTS).map(
      ([name, c], i) => `import { ${c.exportName} as C${i} } from ${JSON.stringify(c.from)}; /* ${name} */`,
    ),
    `const registry = {${Object.keys(COMPONENTS).map((name, i) => `${JSON.stringify(name)}: C${i}`).join(",")}};`,
    `export function render(name, props) {`,
    `  const Component = registry[name];`,
    `  if (!Component) throw new Error("unknown component: " + name);`,
    `  return renderToStaticMarkup(createElement(Component, props || {}));`,
    `}`,
    `export const names = Object.keys(registry);`,
  ].join("\n");

  const bundle = await build({
    stdin: { contents: entry, resolveDir: webviewDir.pathname, loader: "tsx", sourcefile: "sx-render-entry.tsx" },
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    // Assets the components drag in. vite treats css as a separate file and svg as a URL,
    // but here **swallowing them as text is enough** — what we look at is the rendered
    // letters, not the styling. Without this, StartPage stalls on `./start.css`.
    loader: { ".css": "text", ".svg": "text", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
    write: false,
    logLevel: "silent",
  });

  // Give only what the webview code touches at module top level. No host bridge — whether
  // it renders without the bridge is the very fact this instrument is checking.
  const windowStub = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: nodeRequire,
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
    URL,
    window: windowStub,
    self: windowStub,
  };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  compiled = module.exports;
  return compiled;
}

/** Renders the real component to static HTML. */
export async function renderComponent(name, props = {}) {
  const api = await loadBundle();
  return api.render(name, props);
}

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "button", "dd", "details", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "img", "input", "label", "legend", "li", "main", "nav", "ol", "option", "p", "pre", "section",
  "select", "summary", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "tr", "ul",
]);

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·",
};

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/**
 * Pulls only the **visible text** out of the markup. Block element boundaries become
 * newlines — so the sentence-scoped negation exemption (sx-audit.mjs) does not blend with
 * the sentence in the neighboring element.
 */
export function visibleText(html) {
  const stripped = String(html ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (_whole, tag) =>
      BLOCK_TAGS.has(tag.toLowerCase()) ? "\n" : "",
    );
  return decodeEntities(stripped)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Render + text extraction in one step. */
export async function renderVisibleText(name, props = {}) {
  return visibleText(await renderComponent(name, props));
}
