import { staticTokens } from "./lib/expand-design-tokens.mjs";
// REQ-STUDIO-PREVIEW-RECOVERY (CGP-ART-R-009 / REQ-ART-09, DES-ART-09; extends #751 U4) — the webview
// side: the real ChatPanel on the minimal DOM (fixtures/mini-dom.mjs) asks the host for the preview's
// state, draws one cause line and exactly one action for each cause in personal and classroom chat,
// reads navigator.onLine itself, and posts the action the line names. The pure mapping and the host's
// refusal are test/preview-failure.test.mjs.
// Bundled with esbuild and run with plain Node; the banner captures what the panel posts to the host.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { PREVIEW_RECOVERY_ACTIONS, PREVIEW_RECOVERY_NOTES, type PreviewRecoveryResult, type PreviewSignals } from "../src/previewFailure";
import type { ChatConfig } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = (globalThis as unknown as { __posted: Array<{ type: string; action?: string }> }).__posted;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (a !== b) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const classroom = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const personal = {
  ...classroom, profile: { ...(classroom as unknown as { profile: object }).profile, activity_kind: "personal" },
  activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;

type El = {
  getAttribute(n: string): string | null; textContent: string; localName: string;
  findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean;
};

const win = () => (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window;
function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { value: online, configurable: true });
}

const mounted: Root[] = [];
async function harness(config: ChatConfig) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props: Record<string, unknown> = {
    messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
    config, instructor: false,
  };
  await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  const card = () => host.findAll((e) => e.getAttribute("data-testid") === "preview-recovery")[0];
  return {
    card,
    buttons: () => (card() ? card().findAll((e) => e.localName === "button") : []),
    press: async (el: El) => act(async () => { click(el); }),
    state: async (signals: PreviewSignals | null, result?: PreviewRecoveryResult) => act(async () => { win().dispatchEvent({ type: "message", bubbles: false, data: { type: "previewRecovery", signals, ...(result ? { result } : {}) } }); }),
    note: () => host.findAll((e) => e.getAttribute("data-testid") === "preview-recovery-note")[0],
    net: async (online: boolean) => act(async () => { setOnline(online); win().dispatchEvent({ type: online ? "online" : "offline", bubbles: false }); }),
  };
}

const sig = (over: Partial<PreviewSignals> = {}): PreviewSignals => ({ server: "running", status: 200, path: "/", needsNetwork: false, ...over });
const CASES: Array<{ name: string; s: PreviewSignals; online: boolean; text: string; label: string; action: string }> = [
  { name: "server_down", s: sig({ server: "stopped", status: null }), online: true, text: "미리보기 서버가 꺼져 있어요.", label: "다시 켜기", action: "restart_preview" },
  { name: "not_found", s: sig({ status: 404, path: "/play/game.html" }), online: true, text: "game.html 파일이 없어서 페이지를 열 수 없어요.", label: "파일 목록 보기", action: "show_files" },
  { name: "offline", s: sig({ status: null, server: "stopped", needsNetwork: true }), online: false, text: "인터넷 연결이 끊겨서 미리보기를 열 수 없어요.", label: "다시 시도", action: "retry" },
  { name: "slow", s: sig({ server: "slow", status: null }), online: true, text: "미리보기가 응답이 늦어요.", label: "다시 시도", action: "retry" },
  { name: "unknown", s: sig({ status: 500 }), online: true, text: "미리보기를 열지 못했어요.", label: "다시 시도", action: "retry" },
];

for (const [seat, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${seat}: the panel asks the host for the preview's state on mount`, async () => {
    posted.length = 0;
    await harness(config);
    ok(posted.some((m) => m.type === "previewRecoveryRequest"), "previewRecoveryRequest posted");
  });

  for (const c of CASES) {
    t(`${seat}: ${c.name} shows one cause line and exactly one action that posts ${c.action}`, async () => {
      await (async () => { setOnline(true); })();
      const h = await harness(config);
      eq(h.card(), undefined, "no card before the host says so (negative control)");
      if (!c.online) await h.net(false);
      await h.state(c.s);
      ok(h.card(), "card drawn");
      eq(h.card().getAttribute("role"), "status", "announced politely");
      ok(h.card().textContent.includes(c.text), `cause line: ${h.card().textContent}`);
      const buttons = h.buttons();
      eq(buttons.length, 1, "exactly one action");
      eq(buttons[0].textContent.trim(), c.label, "action label");
      eq(buttons[0].getAttribute("type"), "button", "a real button");
      ok((buttons[0].getAttribute("class") ?? "").includes("hps-preview-recovery-action"), "44px class");
      ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|역량/.test(h.card().textContent), "no capability labels");
      posted.length = 0;
      await h.press(buttons[0]);
      const sent = posted.filter((m) => m.type === "previewRecoveryAction");
      eq(sent.length, 1, "one host message");
      eq(sent[0].action, c.action, "the action the line names");
      eq(sent[0].action, PREVIEW_RECOVERY_ACTIONS[c.name as keyof typeof PREVIEW_RECOVERY_ACTIONS].action, "same table as the host");
      posted.length = 0;
      await h.press(h.buttons()[0]);
      eq(posted.filter((m) => m.type === "previewRecoveryAction").length, 0, "a second press while the host works sends nothing");
      // A state pushed by a tab event (no result) does not re-enable the button: only the press's answer does.
      await h.state(c.s);
      eq(h.buttons()[0].getAttribute("aria-disabled"), "true", "still busy until the press is answered");
      await h.state(c.s, "done");
      eq(h.buttons()[0].getAttribute("aria-disabled"), null, "answered: the button is back");
      eq(h.note(), undefined, "a press that ran gets no extra line");
      // The host answers: the page is back (positive control), and the card goes.
      await h.state(sig());
      eq(h.card(), undefined, "card gone when the page answered");
      if (!c.online) await h.net(true);
    });
  }

  t(`${seat}: the offline line follows navigator.onLine, and only for a page that needs the network`, async () => {
    setOnline(true);
    const h = await harness(config);
    await h.state(sig({ status: 404, path: "/a.html" }));
    await h.net(false);
    ok(h.card().textContent.includes("a.html 파일이 없어서"), "a loopback page keeps its own cause offline (negative control)");
    await h.state(sig({ status: 200, needsNetwork: true }));
    ok(h.card().textContent.includes("인터넷 연결이 끊겨서"), "network page while offline");
    await h.net(true);
    eq(h.card(), undefined, "back online, the page answered: no card");
  });

  t(`${seat}: a refused or failed press says it did not run, and the button comes back`, async () => {
    setOnline(true);
    const h = await harness(config);
    const down = sig({ server: "stopped", status: null });
    await h.state(down);
    await h.press(h.buttons()[0]);
    eq(h.buttons()[0].getAttribute("aria-disabled"), "true", "busy");
    await h.state(down, "failed");
    eq(h.buttons()[0].getAttribute("aria-disabled"), null, "re-enabled after a failure");
    ok(h.note()?.textContent.includes(PREVIEW_RECOVERY_NOTES.failed), "failed line");
    await h.press(h.buttons()[0]);
    eq(h.note(), undefined, "a new press clears the old line");
    await h.state(sig({ status: 404, path: "/a.html" }), "refused");
    ok(h.note()?.textContent.includes(PREVIEW_RECOVERY_NOTES.refused), "refused line under the new cause");
    eq(h.buttons().length, 1, "still one action");
    eq(h.buttons()[0].textContent.trim(), "파일 목록 보기", "the action follows the fresh state");
    // Refused because the page came back meanwhile: no card, one line that says the press did not run.
    await h.press(h.buttons()[0]);
    await h.state(sig(), "refused");
    eq(h.card(), undefined, "no card");
    ok(h.note()?.textContent.includes(PREVIEW_RECOVERY_NOTES.refusedGone), "standalone line");
    await h.state(null);
    eq(h.note(), undefined, "the line goes once the preview tab is gone");
  });

  t(`${seat}: an unknown status stays generic`, async () => {
    setOnline(true);
    const h = await harness(config);
    await h.state(sig({ server: "other", status: 404, path: "/game.html" }));
    const text = h.card().textContent;
    ok(text.includes("미리보기를 열지 못했어요."), text);
    ok(!text.includes("game.html") && !text.includes("서버가 꺼져") && !text.includes("인터넷"), "claims no specific cause");
    eq(h.buttons()[0].textContent.trim(), "다시 시도");
  });
}

t("styles: shared rule, 14px+ type-scale tokens, a 44px action, forced-colors safe", () => {
  const css = designValues(readFileSync("webview-ui/src/styles.css", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => new RegExp(`(?:^|\\})\\s*\\.${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  ok(/font-size:\s*var\(--hp-font-body\)/.test(rule("hps-preview-recovery-text")), "cause line at body size");
  ok(/font-size:\s*var\(--hp-font-caption\)/.test(rule("hps-preview-recovery-action")), "action label at caption size (14px floor)");
  ok(/font-size:\s*var\(--hp-font-caption\)/.test(rule("hps-preview-recovery-detail")), "detail at caption size");
  const action = rule("hps-preview-recovery-action");
  ok(/min-height:\s*44px/.test(action) && /min-width:\s*44px/.test(action), "44px target");
  ok(/flex-wrap:\s*wrap/.test(rule("hps-preview-recovery")), "wraps on a narrow panel");
  const forced = /@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/g;
  let found = false;
  for (const m of css.matchAll(forced)) if (/\.hps-preview-recovery-action\s*\{[^}]*border[^}]*ButtonText/.test(m[1])) found = true;
  ok(found, "forced colors: the action keeps a ButtonText border");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} preview-recovery check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} preview-recovery checks passed`);
  process.exit(0);
})();

function designValues(css: string): string { return staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(css); }
