// CGP-ART-D-008 — the minor blocked notice and its "선생님께 알리기", rendered from the real components on mini-dom:
//   B1  the banner names the host in bold (whole up to 48 characters, middle ellipsis beyond, never fewer than 24 shown),
//       uses the refusal banner's theme pair and is an alert; it has 선생님께 알리기 only when the help channel is ready.
//   B2  선생님께 알리기 puts the host into the learner's own help draft (saved as a draft, nothing sent) and opens the panel;
//       a preview already open is never edited; the same notice does not add the line twice.
//   B3  withPrefill: positive and negative controls.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ExternalLinkBlocked, BLOCKED_HOST_MAX, blockedLinkHelpText } from "../webview-ui/src/ExternalLinkBlocked";
import { HelpRequest, withPrefill } from "../webview-ui/src/HelpRequest";

// mini-dom has no HTMLSelectElement.options; React reads it when it draws the help form's duration <select>.
const ElementCtor = (globalThis.window as unknown as { Element: { prototype: object } }).Element;
if (!Object.getOwnPropertyDescriptor(ElementCtor.prototype, "options")) {
  Object.defineProperty(ElementCtor.prototype, "options", { get(this: { findAll(t: (e: { localName: string }) => boolean): unknown[] }) { return this.findAll((e) => e.localName === "option"); } });
}
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const noop = () => {};

t("B1 banner: title, bold host, alert, theme pair, ask button only when the channel is ready", () => {
  const html = renderToStaticMarkup(<ExternalLinkBlocked host="games.example.com" canAskTeacher onAskTeacher={noop} onDismiss={noop} />);
  ok(html.includes("이 사이트는 수업에서 열 수 없어요"), "title copy");
  ok(/role="alert"/.test(html) && /class="hps-refusal-banner"/.test(html), "alert on the refusal banner's theme pair");
  ok(/<strong data-link-blocked-host="" title="games.example.com">games.example.com<\/strong>/.test(html), "host whole and bold");
  ok(html.includes("선생님께 알리기"), "ask button when ready");
  const none = renderToStaticMarkup(<ExternalLinkBlocked host="games.example.com" canAskTeacher={false} onAskTeacher={noop} onDismiss={noop} />);
  ok(!none.includes("선생님께 알리기") && none.includes("닫기"), "no ask button without the help channel; 닫기 stays");
  const long = "a-very-long-subdomain-name-for-testing.another-long-label.example-host.co.kr";
  const lhtml = decode(renderToStaticMarkup(<ExternalLinkBlocked host={long} canAskTeacher={false} onAskTeacher={noop} onDismiss={noop} />));
  const shown = /data-link-blocked-host="" title="[^"]*">([^<]*)</.exec(lhtml)?.[1] ?? "";
  ok(shown.length === BLOCKED_HOST_MAX && shown.includes("…"), `middle ellipsis at ${BLOCKED_HOST_MAX}: ${shown}`);
  ok(shown.indexOf("…") >= 12 && shown.length - shown.indexOf("…") - 1 >= 12, "ellipsis in the middle, both ends kept");
  ok(shown.replace("…", "").length >= 24, "never fewer than 24 host characters shown");
  ok(shown.endsWith(".co.kr") && shown.startsWith("a-very-long"), "start and registrable end kept");
  const exact = "x".repeat(BLOCKED_HOST_MAX - 4) + ".com";
  ok(renderToStaticMarkup(<ExternalLinkBlocked host={exact} canAskTeacher={false} onAskTeacher={noop} onDismiss={noop} />).includes(`>${exact}<`), "48 characters shown whole");
});

type N = { findAll(test: (e: N) => boolean): N[]; hasAttribute(n: string): boolean; getAttribute(n: string): string | null; open?: boolean; value?: string; textContent: string };
const withAttr = (root: N, attr: string) => root.findAll((e) => e.hasAttribute(attr));
const view = (envelope: object | null) => ({
  generation: 1, draft_key: "c|p|u|run", seat: "A-07",
  availability: { state: "ready", assignment: { recipient_id: "강사-김하나", seat_id: "A-07" } },
  draft: { question: "버튼이 안 눌려요", turnId: null, duration: 30, updated_at: 1 }, turns: [], envelope,
  current: [], history: [], refresh: { state: "ok", at: 1 }, note: null,
}) as never;

t("B2 선생님께 알리기 fills the learner's own draft, opens the panel, sends nothing; a preview is left alone", async () => {
  const posted: Array<{ type: string; draft?: { question: string } }> = [];
  const host = mountPoint() as unknown as N, root = createRoot(host as never);
  const line = blockedLinkHelpText("games.example.com");
  await act(async () => { root.render(<HelpRequest view={view(null)} post={(m) => posted.push(m)} prefill={null} />); });
  const panel = host.findAll((e) => (e as unknown as { localName: string }).localName === "details")[0];
  ok(panel && !panel.open, "fixture: panel closed");
  let used = 0;
  await act(async () => { root.render(<HelpRequest view={view(null)} post={(m) => posted.push(m)} prefill={{ text: line, nonce: 7 }} onPrefillUsed={() => used++} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  ok(used === 1, "the prefill reports itself consumed once");
  ok(panel.open === true, "panel opened on the draft");
  const q = withAttr(host, "data-help-question")[0];
  ok(q && q.value === `버튼이 안 눌려요\n${line}`, `draft has the host line appended: ${JSON.stringify(q?.value)}`);
  const drafts = posted.filter((m) => m.type === "helpDraft");
  ok(drafts.length === 1 && drafts[0].draft?.question === `버튼이 안 눌려요\n${line}`, "saved as a draft once");
  ok(!posted.some((m) => m.type === "helpSend" || m.type === "helpPreview"), "nothing previewed or sent");
  // Same notice again (re-render with the same nonce): no second line.
  await act(async () => { root.render(<HelpRequest view={view(null)} post={(m) => posted.push(m)} prefill={{ text: line, nonce: 7 }} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  ok(posted.filter((m) => m.type === "helpDraft").length === 1, "same nonce does not add the line twice");
  await act(async () => root.unmount());

  // A preview is open (envelope present): the prefill never edits it.
  const posted2: Array<{ type: string }> = [];
  const host2 = mountPoint() as unknown as N, root2 = createRoot(host2 as never);
  const env = { request_id: "req-1", draft_key: "c|p|u|run", send_key: "k", recipient_id: "강사-김하나", class_run_id: "run", grant_id: "g", seat_id: "A-07", duration_minutes: 30,
    content: { question: "q" }, prepared_at: 1, class_ends_at: "2099-01-01T00:00:00Z", consent_expires_at: 4_000_000_000, consent_proof: "p", state: "prepared", truncated: [] };
  await act(async () => { root2.render(<HelpRequest view={view(env)} post={(m) => posted2.push(m)} prefill={{ text: line, nonce: 8 }} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  ok(!posted2.some((m) => m.type === "helpDraft"), "no draft write while a preview is open");
  await act(async () => root2.unmount());
});

t("B3 withPrefill: appends once, keeps an empty draft clean", () => {
  ok(withPrefill("", "L") === "L", "empty draft becomes the line");
  ok(withPrefill("질문  \n", "L") === "질문\nL", "trailing space trimmed, line appended");
  ok(withPrefill("질문\nL", "L") === "질문\nL", "negative control: already there, unchanged");
  ok(withPrefill("질문", "") === "질문", "negative control: empty line, unchanged");
});

void (async () => {
  let fail = 0;
  for (const [label, fn] of tests) {
    try { await fn(); console.log("PASS " + label); } catch (e) { fail++; console.error("FAIL " + label + ": " + (e as Error).message); }
  }
  process.exit(fail ? 1 : 0);
})();
