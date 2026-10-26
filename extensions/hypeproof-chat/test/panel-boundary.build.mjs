// CGP-SHELL-R-013 — bundles test/panel-boundary.test.tsx with the real webview sources, after
// instrumenting each panel's own component: at the top of its function body the component records
// that it rendered, throws when the test names it in `globalThis.__hpsPanelThrow`, and renders
// nothing when the test lists it in `globalThis.__hpsStub`. The throw is inside the component, so a
// panel moved outside its PanelBoundary lets the error reach the top-level boundary and the test
// fails. The instrumentation refuses to build if a listed component cannot be found exactly once.
//   node test/panel-boundary.build.mjs <outfile>
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
export const PANEL_COMPONENTS = {
  "AccessControl.tsx": ["AccessControl"],
  "ChatPanel.tsx": ["AiCanDo", "CapabilityChangeCard", "LongStepHintLine", "CitationRack"],
  "ChatFindBar.tsx": ["ChatFindBar"],
  "CitationPreview.tsx": ["CitationPreview", "CitationRack"],
  "CompletionGate.tsx": ["CompletionGate"],
  "DelegationRow.tsx": ["DelegationRow"],
  "DelegationGroup.tsx": ["DelegationGroup"],
  // Not a panel of its own: stubbed so the evidence row renders (mini-dom has no <select>).
  "EvidenceDrawer.tsx": ["EvidenceDrawer"],
  "EvidencePanel.tsx": ["EvidencePanel"],
  "GoalStatusBar.tsx": ["GoalStatusBar"],
  "HelpRequest.tsx": ["HelpRequest"],
  "InstructorInbox.tsx": ["InstructorInbox"],
  "LessonStepPanel.tsx": ["LessonStepPanel"],
  "LessonTip.tsx": ["LessonTip"],
  "MaterialsPanel.tsx": ["MaterialsPanel"],
  "MemoryPanel.tsx": ["MemoryPanel"],
  "MissingFolderNotice.tsx": ["MissingFolderNotice"],
  "MissionHeader.tsx": ["MissionHeader"],
  "NativeObservationPanel.tsx": ["NativeObservationPanel"],
  "PageCard.tsx": ["PageCard"],
  "PreviewRecoveryNotice.tsx": ["PreviewRecoveryNotice"],
  "ProjectIdeas.tsx": ["ProjectIdeas"],
  "PublishPanel.tsx": ["PublishPanel"],
  "ReviewPanel.tsx": ["ReviewPanel"],
  "SkillsPanel.tsx": ["SkillsPanel"],
  "StudentGoal.tsx": ["StudentGoal"],
  "TaskActivity.tsx": ["TaskActivity"],
  "TrialCarryover.tsx": ["TrialCarryover"],
  "TrialEndCard.tsx": ["TrialEndCard"],
  "TurnReviewBar.tsx": ["TurnReviewBar"],
  "VerifyPanel.tsx": ["VerifyPanel"],
};

/** Insert the hook at the start of `function name(...)`'s body. Exported for the self-check. */
export function instrument(source, file, name) {
  const head = `function ${name}(`;
  const at = source.indexOf(head);
  if (at < 0 || source.indexOf(head, at + 1) >= 0) throw new Error(`instrument: ${file} must declare ${head} exactly once`);
  let i = at + head.length, depth = 1;
  for (; i < source.length && depth; i++) depth += source[i] === "(" ? 1 : source[i] === ")" ? -1 : 0;
  const brace = source.indexOf("{", i);
  const between = source.slice(i, brace);
  if (!/^\s*(:\s*[\w.<>[\]| ]+)?\s*$/.test(between)) throw new Error(`instrument: ${file} ${name}: unexpected text before the body: ${JSON.stringify(between)}`);
  const key = JSON.stringify(`${file}:${name}`);
  const hook = ` (globalThis.__hpsRendered ??= new Set()).add(${key}); if (globalThis.__hpsPanelThrow === ${key}) throw new Error("hps-test: forced throw in " + ${key}); if (globalThis.__hpsStub?.has(${key})) return null;`;
  return source.slice(0, brace + 1) + hook + source.slice(brace + 1);
}

const instrumentPanels = {
  name: "instrument-panels",
  setup(b) {
    b.onLoad({ filter: /webview-ui\/src\/[A-Za-z]+\.tsx$/ }, async (args) => {
      const names = PANEL_COMPONENTS[basename(args.path)];
      if (!names) return undefined;
      let source = await readFile(args.path, "utf8");
      for (const name of names) source = instrument(source, basename(args.path), name);
      return { contents: source, loader: "tsx" };
    });
  },
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const outfile = process.argv[2] ?? "/tmp/panel-boundary.test.cjs";
  await build({
    entryPoints: [resolve(ROOT, "test/panel-boundary.test.tsx")],
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "error",
    nodePaths: [resolve(ROOT, "webview-ui/node_modules")],
    alias: { react: resolve(ROOT, "webview-ui/node_modules/react"), "react-dom": resolve(ROOT, "webview-ui/node_modules/react-dom") },
    loader: { ".css": "empty", ".svg": "empty" },
    external: ["vscode"],
    banner: { js: "globalThis.__posted = []; globalThis.window = globalThis.window ?? {}; globalThis.window.acquireVsCodeApi = () => ({ postMessage: (m) => globalThis.__posted.push(m), getState() {}, setState() {} });" },
    plugins: [instrumentPanels],
    outfile,
  });
}
