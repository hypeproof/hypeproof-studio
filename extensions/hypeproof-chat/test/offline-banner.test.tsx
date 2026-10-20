// CGP-SHELL-R-011 (REQ-STUDIO-OFFLINE-BANNER) — when the webview loses the network, the chat panel
// shows one calm status banner that says what still works, holds sending (the draft stays), and
// announces the reconnect once without sending anything. Bundled with esbuild, run with plain Node.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import {
  OFFLINE_BANNER_TEXT, ONLINE_ANNOUNCEMENT, OFFLINE_HELD_NOTES,
  readOnline, connectivityStep, watchConnectivity, offlineHoldsSend, guardSend,
  liveRegionStep, liveRegionText, type LiveRegionState, type ConnectivityState,
} from "../webview-ui/src/connectivity";
import { responseAnnouncement } from "../webview-ui/src/responseAnnouncer";
import { verifyPressAction, verifyNote } from "../webview-ui/src/verifyOffline";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown) => { if (a !== b) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

// --- pure state -------------------------------------------------------------------------------

t("readOnline: only an explicit false is offline", () => {
  eq(readOnline({ onLine: false }), false);
  eq(readOnline({ onLine: true }), true);
  eq(readOnline(undefined), true);
  eq(readOnline({}), true);
});
t("offline event: banner state, no announcement", () => {
  const s = connectivityStep({ online: true, announcement: "" }, "offline");
  eq(s.online, false); eq(s.announcement, "");
});
t("online after offline: back online, announced once", () => {
  const s = connectivityStep({ online: false, announcement: "" }, "online");
  eq(s.online, true); eq(s.announcement, ONLINE_ANNOUNCEMENT);
});
t("negative control: online while already online is not announced", () => {
  const prev = { online: true, announcement: "" };
  eq(connectivityStep(prev, "online"), prev);
  const off = { online: false, announcement: "" };
  eq(connectivityStep(off, "offline"), off);
});
t("send is held only while offline", () => {
  eq(offlineHoldsSend(false), true);
  eq(offlineHoldsSend(true), false);
});

// --- event wiring (Node's EventTarget stands in for window) -----------------------------------

t("watchConnectivity follows offline/online events and stops after unsubscribe", () => {
  const target = new EventTarget();
  const nav = { onLine: true };
  const seen: boolean[] = [];
  const stop = watchConnectivity(target, nav, (online) => seen.push(online));
  nav.onLine = false; target.dispatchEvent(new Event("offline"));
  nav.onLine = true; target.dispatchEvent(new Event("online"));
  stop();
  target.dispatchEvent(new Event("offline"));
  eq(seen.join(","), "true,false,true");
});
t("watchConnectivity reports a drop that happened before it subscribed", () => {
  const seen: boolean[] = [];
  watchConnectivity(new EventTarget(), { onLine: false }, (online) => seen.push(online));
  eq(seen.join(","), "false");
});
t("F3: a reconnect that landed before the subscribe still clears the offline state", () => {
  // First render read offline; the `online` event fired before the listener was attached.
  let state: ConnectivityState = { online: false, announcement: "" };
  watchConnectivity(new EventTarget(), { onLine: true }, (online) => { state = connectivityStep(state, online ? "online" : "offline"); });
  eq(state.online, true);
});

// --- copy -------------------------------------------------------------------------------------

t("copy says the connection dropped and what still works", () => {
  ok(OFFLINE_BANNER_TEXT.includes("인터넷 연결이 끊겼어요"), "dropped");
  ok(OFFLINE_BANNER_TEXT.includes("파일") && OFFLINE_BANNER_TEXT.includes("쓰던 글"), "files and draft are kept");
  ok(OFFLINE_BANNER_TEXT.includes("연결되면"), "sending waits for the connection");
  ok(ONLINE_ANNOUNCEMENT.includes("다시 연결"), "reconnect line");
  for (const s of [OFFLINE_BANNER_TEXT, ONLINE_ANNOUNCEMENT, ...Object.values(OFFLINE_HELD_NOTES)]) {
    ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|점수|역량/.test(s), `no capability or score label: ${s}`);
  }
});

t("F4: each held note names where the words actually are", () => {
  ok(OFFLINE_HELD_NOTES.draft.includes("입력창"), "draft: composer");
  ok(OFFLINE_HELD_NOTES.edit.includes("수정 칸") && !OFFLINE_HELD_NOTES.edit.includes("입력창"), "edit: the edit box");
  ok(OFFLINE_HELD_NOTES.kept.includes("보관한 메시지") && !OFFLINE_HELD_NOTES.kept.includes("입력창"), "kept: the kept row");
  ok(OFFLINE_HELD_NOTES.press.includes("다시 눌러") && !OFFLINE_HELD_NOTES.press.includes("입력창"), "press: nothing typed");
  for (const n of Object.values(OFFLINE_HELD_NOTES)) ok(n.startsWith("지금은 인터넷이 끊겨서 보내지 않았어요."), `same opening: ${n}`);
});

// --- F1: the live region, driven through a real sequence of the two sources --------------------
// The response line comes from responseAnnouncer's own transition (and its clear-then-settle), the
// reconnect line from connectivityStep, and the region from liveRegionStep, the same step
// useLiveRegion runs on every ChatPanel render.

type Compose = (prev: LiveRegionState, values: readonly string[]) => LiveRegionState;
const OLD_OR: Compose = (_prev, values) => ({ values, owner: values[0] ? 0 : values[1] ? 1 : -1 }); // the shipped `a || b`
function runScenario(compose: Compose, steps: string[]): string[] {
  const ctx = { personal: false, stopped: false, failed: false };
  let response = "", streaming = false;
  let conn: ConnectivityState = { online: true, announcement: "" };
  let region: LiveRegionState = { values: ["", ""], owner: -1 };
  const heard: string[] = [];
  const render = () => { region = compose(region, [response, conn.announcement]); heard.push(liveRegionText(region)); };
  for (const step of steps) {
    if (step === "start") { response = responseAnnouncement(streaming, true, ctx) ?? response; streaming = true; render(); }
    else if (step === "finish") { response = ""; render(); response = responseAnnouncement(true, false, ctx) ?? ""; streaming = false; render(); }
    else if (step === "offline" || step === "online") { conn = connectivityStep(conn, step); render(); }
    else if (step === "expire") { conn = { ...conn, announcement: "" }; render(); }
  }
  return heard;
}
const last = (xs: string[]) => xs[xs.length - 1];
t("F1: finish a turn, go offline, come back online: the reconnect line is announced", () => {
  const heard = runScenario(liveRegionStep, ["start", "finish", "offline", "online"]);
  eq(heard[1 + 1], "답변이 끝났어요");
  eq(last(heard), ONLINE_ANNOUNCEMENT);
});
t("F1 negative control: the shipped `response || reconnect` composition fails the same scenario", () => {
  const heard = runScenario(OLD_OR, ["start", "finish", "offline", "online"]);
  ok(last(heard) !== ONLINE_ANNOUNCEMENT, "old composition passed the scenario, so the scenario cannot see F1");
});
t("F1: reconnect while a classroom turn is running is announced over '답변을 시작했어요'", () =>
  eq(last(runScenario(liveRegionStep, ["start", "offline", "online"])), ONLINE_ANNOUNCEMENT));
t("F1: when the reconnect line expires the region goes quiet; it never re-announces the old completion", () =>
  eq(last(runScenario(liveRegionStep, ["start", "finish", "offline", "online", "expire"])), ""));
t("F1: the next completion after a reconnect is announced again", () =>
  eq(last(runScenario(liveRegionStep, ["start", "finish", "offline", "online", "expire", "start", "finish"])), "답변이 끝났어요"));
t("F1 negative control: no reconnect, no reconnect line (online at start, a turn finishes)", () =>
  eq(last(runScenario(liveRegionStep, ["start", "finish"])), "답변이 끝났어요"));
t("liveRegionStep is idempotent for a re-render with the same values", () => {
  const a = liveRegionStep({ values: ["", ""], owner: -1 }, ["x", ""]);
  eq(liveRegionStep(a, ["x", ""]), a);
});

// --- render: personal and classroom -----------------------------------------------------------

const noop = () => {};
const PROPS = {
  messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
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

const withNavigator = (onLine: boolean | undefined, fn: () => void) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: onLine === undefined ? {} : { onLine }, configurable: true });
  try { fn(); } finally { if (before) Object.defineProperty(globalThis, "navigator", before); }
};
const render = (config: ChatConfig, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<ChatPanel {...PROPS} config={config} instructor={false} {...extra} />);
const banner = (html: string) => /<div class="hps-offline-banner" role="status" data-testid="offline-banner">([\s\S]*?)<\/div>/.exec(html);

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: offline shows one status banner with the copy, above the messages`, () => withNavigator(false, () => {
    const html = render(config);
    const m = banner(html);
    ok(m, "banner missing");
    ok(m![1].includes(OFFLINE_BANNER_TEXT), "copy");
    eq(html.split('data-testid="offline-banner"').length - 1, 1);
    ok(html.indexOf('data-testid="offline-banner"') < html.indexOf('class="hps-messages"'), "sits above the message list");
    ok(!/<button[^>]*>[^<]*<\/button>\s*<\/div>/.test(m![0]) && !m![0].includes("<button"), "no button, nothing modal");
    ok(!m![0].includes('role="alert"') && !m![0].includes('aria-modal'), "non-modal status, not an alert");
  }));
  t(`${mode}: negative control — online (or unknown) shows no banner`, () => {
    withNavigator(true, () => ok(!banner(render(config)), "banner while online"));
    withNavigator(undefined, () => ok(!banner(render(config)), "banner with unknown state"));
  });
  t(`${mode}: offline keeps the draft in the composer`, () => withNavigator(false, () => {
    const html = render(config);
    ok(/<textarea[^>]*>/.test(html), "composer still drawn");
    ok(!/<textarea[^>]*disabled/.test(html), "composer still writable");
  }));
}

// --- one guarded send helper: offline holds, online passes ------------------------------------

const spy = (ret?: unknown) => { const calls: number[] = []; const fn = () => { calls.push(1); return ret; }; return { fn, calls }; };
t("guardSend offline: the send is not called and the held note is shown once", () => {
  const send = spy(), held = spy();
  eq(guardSend(false, send.fn, held.fn), false);
  eq(send.calls.length, 0); eq(held.calls.length, 1);
});
t("negative control: guardSend online calls the send and shows no note", () => {
  const send = spy(), held = spy();
  eq(guardSend(true, send.fn, held.fn), true);
  eq(send.calls.length, 1); eq(held.calls.length, 0);
});
t("guardSend online passes a host refusal through (false stays false)", () => {
  const held = spy();
  eq(guardSend(true, spy(false).fn, held.fn), false);
  eq(held.calls.length, 0);
});

// --- source contracts: every learner send goes through sendWhenOnline -------------------------

const panel = readFileSync("webview-ui/src/ChatPanel.tsx", "utf8");
const conn = readFileSync("webview-ui/src/connectivity.ts", "utf8");
const body = (src: string, start: string) => {
  const at = src.indexOf(start); if (at < 0) return "";
  const end = src.indexOf("\n  };", at); return src.slice(at, end < 0 ? undefined : end);
};
/** The host call sits inside the guard, and the draft/choice is only cleared after it. */
const guarded = (fn: string, call: RegExp) => {
  const m = /sendWhenOnline\(/.exec(fn);
  if (!m) return false;
  const c = call.exec(fn);
  if (!c || c.index < m.index) return false;
  const clear = fn.search(/setDraft\(""\)|setInlineEdit\(undefined\)|setEditingId\(null\)/);
  return clear < 0 || clear > c.index;
};
const PATHS: [string, string, RegExp, RegExp][] = [
  ["composer send (submit)", "const submit = (", /props\.onSend\(/, /, parked \? 'kept' : 'draft'\)\)/],
  ["kept-message retry", "const retryRecovered = (", /props\.onSend\(/, /, 'kept'\)\)/],
  ["friend pick", "const handleWorldPick = (", /props\.onSend\(/, /, 'press'\)\)/],
  ["roll send", "const handleRollSend = (", /props\.onSend\(/, /, 'draft'\)\)/],
  ["edit and resend", "const saveEdit = (", /props\.onEditResend\?\.\(/, /, 'edit'\)\)/],
];
for (const [label, start, call, kind] of PATHS) {
  t(`${label} is held while offline before anything is cleared`, () => ok(guarded(body(panel, start), call), label));
  t(`${label} uses its own held note`, () => ok(kind.test(body(panel, start)), `${label}: ${kind}`));
  t(`negative control: ${label} without the guard fails the check`, () => {
    const planted = body(panel, start).replace(/sendWhenOnline\(/g, "(");
    ok(!guarded(planted, call), "check accepted an unguarded path");
  });
}
t("retry-last (error banner) goes through the guard", () =>
  ok(/onRetry=\{\(\) => \{[^\n]*recoverToComposer\(\(\) => \{ sendWhenOnline\(props\.onRetryLast, 'press'\)/.test(panel), "retry-last"));
t("ask-again on an answer goes through the guard", () =>
  ok(/onRetry=\{\(prompt, source\) => \{ sendWhenOnline\(\(\) => props\.onRetry\(prompt, source\), 'press'\)/.test(panel), "ask again"));
t("every host send call in ChatPanel sits on a guarded line (no sixth copy)", () => {
  const lines = panel.split("\n").filter((l) => /props\.(onSend\(|onEditResend\?\.\(|onRetryLast\b|onRetry\b)/.test(l));
  const unguarded = lines.filter((l) => !l.includes("sendWhenOnline("));
  ok(lines.length >= 7, `expected at least 7 send call lines, found ${lines.length}`);
  ok(unguarded.length === 0, `unguarded: ${unguarded.map((l) => l.trim().slice(0, 80)).join(" | ")}`);
  eq((panel.match(/OFFLINE_HELD_NOTES/g) ?? []).length, 2); // import + the one helper
});

// F2 — App.tsx and every component: a host message that starts a chat turn is posted only from
// a guarded line, or from one of App's ChatPanel callbacks; those callbacks are only handed to
// ChatPanel (whose calls are guarded above) or called on a guarded line.
const SRC = "webview-ui/src";
const sources = readdirSync(SRC).filter((f) => /\.tsx?$/.test(f)).map((f) => ({ f, text: readFileSync(`${SRC}/${f}`, "utf8") }));
// L2 — whitespace-tolerant, and any object literal of a turn-starting type, not only `postToHost({`.
const TURN_POST = /\{\s*type:\s*"(sendMessage|retryMessage|verifyStart|verifyFix|verifyResume)"/;
const GUARD = /guardSend\(|sendWhenOnline\(|verifyWhenOnline\(/;
const CALLBACKS: Record<string, string> = { send: "onSend", retry: "onRetry", editResend: "onEditResend", retryLast: "onRetryLast" };
function turnPostViolations(files: { f: string; text: string }[]): string[] {
  const bad: string[] = [];
  for (const { f, text } of files) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!TURN_POST.test(line) || GUARD.test(line)) return;
      let fn = "";
      for (let j = i; j >= 0; j--) { const m = /^  const (\w+) = /.exec(lines[j]); if (m) { fn = m[1]; break; } }
      if (!(f === "App.tsx" && fn in CALLBACKS)) bad.push(`${f}:${i + 1} (${fn || "?"})`);
    });
    if (f !== "App.tsx") continue;
    for (const [name, prop] of Object.entries(CALLBACKS)) {
      lines.forEach((line, i) => {
        if (new RegExp(`^  const ${name} = `).test(line) || line.trim().startsWith("//")) return;
        const handed = new RegExp(`\\b${prop}=\\{${name}\\}`).test(line);
        const called = new RegExp(`(?<![\\w.])${name}\\(`).test(line);
        if (called && !GUARD.test(line)) bad.push(`App.tsx:${i + 1} calls ${name}() unguarded`);
        if (!handed && !called && new RegExp(`=\\{${name}\\}`).test(line)) bad.push(`App.tsx:${i + 1} hands ${name} to a prop other than ${prop}`);
      });
    }
  }
  return bad;
}
t("F2: every turn-starting post in App.tsx and every component is guarded", () => {
  ok(sources.length > 30, `scanned ${sources.length} files`);
  ok(sources.some(({ text }) => /type: "verifyStart"/.test(text)) && sources.some(({ text }) => /type: "sendMessage"/.test(text)), "scan sees the posts");
  const bad = turnPostViolations(sources);
  ok(bad.length === 0, bad.join("; "));
});
t("F2 negative control: the shipped unguarded verify send and verify start fail the scan", () => {
  const planted = sources.map(({ f, text }) => ({ f, text: f !== "App.tsx" ? text : text
    .replace("guardSend(online, () => send(text), () => setVerifyHeld(true));", "send(text);")
    .replace("onStart={(criteria) => verifyWhenOnline(", "onStart={(criteria) => (") }));
  const bad = turnPostViolations(planted);
  ok(bad.some((b) => b.includes("calls send() unguarded")), `verify send not caught: ${bad.join("; ")}`);
  ok(bad.some((b) => /App\.tsx:\d+ \(\)|App\.tsx:\d+ \(\?\)|App\.tsx:\d+ \(verifyPanel\)/.test(b)), `verify start not caught: ${bad.join("; ")}`);
});
t("L2 probe: an unguarded post written without spaces is still caught", () => {
  const probe = [{ f: "Probe.tsx", text: '  const go = () => {\n    postToHost({type:"verifyStart", requestId: "r", criteria: []});\n  };' }];
  ok(turnPostViolations(probe).length === 1, "no-space post not caught");
  const guardedProbe = [{ f: "Probe.tsx", text: '  const go = () => {\n    verifyWhenOnline(() => postToHost({type:"verifyStart", requestId: "r", criteria: []}));\n  };' }];
  eq(turnPostViolations(guardedProbe).length, 0);
});

// --- N1: a handed-back test turn that could not be sent is parked on the host, resumed once ----
const app = sources.find(({ f }) => f === "App.tsx")!.text;
t("N1: the next press of the same button resumes; a different press, or nothing parked, starts fresh", () => {
  eq(verifyPressAction("start:[1]", "start:[1]"), "resume");
  eq(verifyPressAction("start:[1]", "start:[2]"), "fresh");
  eq(verifyPressAction("start:[1]", "fix:[\"c\",\"t\"]"), "fresh");
  eq(verifyPressAction(null, "start:[1]"), "fresh");
});
t("N1: a handed-back turn that is not sent parks it on the host and remembers which press it was", () => {
  const effect = body(app, "  useEffect(() => {\n    if (!state.verifySend");
  ok(effect.length > 0, "hand-back effect");
  ok(/const sent = guardSend\(online, \(\) => send\(text\), \(\) => setVerifyHeld\(true\)\);/.test(effect), "sent through the gate");
  ok(/if \(!sent\) \{ postToHost\(\{ type: "verifyPark" \}\); setParkedVerify\(lastVerifyKey\.current\); \}/.test(effect), "parked when not sent");
});
t("N1 negative control: the round-1 hand-back (drop with no park) fails the check", () => {
  const old = "  useEffect(() => {\n    if (!state.verifySend || state.streamId) return;\n    const text = state.verifySend;\n    dispatch({ type: \"verifySent\" });\n    guardSend(online, () => send(text), () => setVerifyHeld(true));\n  };";
  ok(!/if \(!sent\) \{ postToHost\(\{ type: "verifyPark" \}\)/.test(body(old, "  useEffect(() => {\n    if (!state.verifySend")), "old drop accepted");
});
t("N1: start and fix post verifyResume instead of re-recording when the parked press matches", () => {
  ok(/onStart=\{\(criteria\) => verifyWhenOnline\(\(\) => \{ const requestId = verifyRequest\(\); postToHost\(pressAction\(`start:\$\{JSON\.stringify\(criteria\)\}`\) === "resume" \? \{ type: "verifyResume", requestId \} : \{ type: "verifyStart", requestId, criteria \}\); \}\)\}/.test(app), "start");
  ok(/onFix=\{\(criterionId, text\) => verifyWhenOnline\(\(\) => \{ const requestId = verifyRequest\(\); postToHost\(pressAction\(`fix:\$\{JSON\.stringify\(\[criterionId, text\]\)\}`\) === "resume" \? \{ type: "verifyResume", requestId \} : \{ type: "verifyFix", requestId, criterionId, text \}\); \}\)\}/.test(app), "fix");
});
t("N1: a resume is a CR verify message the host declares and routes", () => {
  const protocol = readFileSync("src/protocol.ts", "utf8"), cr = readFileSync("src/curriculumRuntime.ts", "utf8");
  for (const type of ["verifyPark", "verifyResume"]) {
    ok(new RegExp(`\\{ type: "${type}"[ ;}]`).test(protocol), `${type} declared`);
    ok(cr.includes(`"${type}"`), `${type} in the CR inventory`);
  }
});

// --- L1: the held note never outlives its press, and never hides a newer host error ----------
t("L1: verifyNote shows the held note only while held, otherwise the host's error", () => {
  eq(verifyNote(true, null), OFFLINE_HELD_NOTES.press);
  eq(verifyNote(false, "코치가 답하는 중이에요."), "코치가 답하는 중이에요.");
  eq(verifyNote(false, null), null);
});
t("L1: the held note clears on 다시 테스트, on close, and whenever the host answers", () => {
  ok(app.includes("error={verifyNote(verifyHeld, state.verifyError)}"), "note slot");
  ok(/onRetest=\{\(\) => \{ setVerifyHeld\(false\); postToHost\(\{ type: "verifyRetest" \}\); \}\}/.test(app), "retest clears");
  ok(/onClose=\{\(\) => \{ setVerifyHeld\(false\); dispatch\(\{ type: "verifyClose" \}\); \}\}/.test(app), "close clears");
  ok(/useEffect\(\(\) => setVerifyHeld\(false\), \[state\.verify, state\.verifyError\]\);/.test(app), "a host answer clears");
  const clearAt = app.indexOf("useEffect(() => setVerifyHeld(false), [state.verify, state.verifyError]);");
  const handBack = app.indexOf("if (!state.verifySend");
  ok(clearAt > 0 && clearAt < handBack, "the clear runs before the hand-back effect in the same commit, so a hold set by the hand-back survives");
});
t("reply and suggestion chips only fill the draft; they never send, so offline keeps them working", () => {
  for (const start of ["const handleReplyChoice = (", "const handleChip = ("]) {
    const fn = body(panel, start);
    ok(fn.length > 0, start);
    ok(!/props\.onSend\(|submit\(/.test(fn), `${start} sends`);
  }
});
t("reconnect never sends: the queue flush still keys on the stream edge, not on connectivity", () => {
  ok(panel.includes("}, [streaming, queued, queuedPaused]);"), "flush effect deps changed");
  ok(!/onSend|postToHost|submit\(/.test(conn), "connectivity module must not send");
});
t("the announcer region renders the live-region result over both sources", () => {
  ok(panel.includes('data-testid="response-announcer">{liveAnnouncement}</div>'), "announcer region");
  ok(panel.includes("useLiveRegion([responseAnnouncementText, connectivity.announcement])"), "both sources, reconnect last");
});

if (fail) { console.error(`offline-banner: ${fail} failed`); process.exit(1); }
console.log("offline-banner OK");
