// REQ-KNOW-09 / CGP-KNOW-R-006 — what the learner sees before content leaves, rendered from the real components
// (bundled with esbuild, run under plain Node, like answer-verdict.test.tsx):
//   R1  help preview (classroom): recipient, every field with its exact byte size, the literal exclusion line in its own
//       body-size element, consent box unchecked and send disabled.
//   R2  나의 변화 기록 submit area: destination, sized parts, the literal exclusion line, 확인하고 제출 / 취소, and no English
//       learner copy (the exact-JSON <pre>/<code> data aside).

//   R3  help re-ask: the consent tick never survives the envelope changing (retry shows an unticked box, send disabled).
//   R4  나의 변화 기록: the preview is dropped when the include option changes the bundle.
// R3/R4 mount the real components with react-dom/client on fixtures/mini-dom.mjs (loaded first) so effects and state run.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpRequest } from "../webview-ui/src/HelpRequest";
import { LocalReview, SubmissionArea } from "../webview-ui/src/LocalReview";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const EXCLUDED = "포함하지 않는 것: AI 기억, 개인 메모";
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const attrText = (html: string, attr: string) => { const m = new RegExp(`<([a-z]+)[^>]*${attr}[^>]*>([\\s\\S]*?)</\\1>`).exec(html); return m ? decode(m[2].replace(/<[^>]+>/g, "")) : null; };

const question = "예약 버튼을 눌러도 아무 일도 안 일어나요 😀", prompt = "버튼 고쳐 줘";
const view = {
  generation: 1, draft_key: "c|p|u|run", seat: "A-07",
  availability: { state: "ready", assignment: { recipient_id: "강사-김하나", seat_id: "A-07" } },
  draft: { question, turnId: null, duration: 30, updated_at: 1 }, turns: [],
  envelope: { request_id: "req-1", draft_key: "c|p|u|run", send_key: "k", recipient_id: "강사-김하나", class_run_id: "run", grant_id: "g", seat_id: "A-07", duration_minutes: 30,
    content: { question, prompt }, prepared_at: 1, class_ends_at: "2099-01-01T00:00:00Z", consent_expires_at: 4_000_000_000, consent_proof: "p", state: "prepared", truncated: [] },
  current: [], history: [], refresh: { state: "ok", at: 1 }, note: null,
} as never;

t("R1 help preview: recipient, exact per-field bytes, literal exclusion line, consent unchecked, send disabled", () => {
  const html = renderToStaticMarkup(<HelpRequest view={view} post={() => {}} />);
  ok(attrText(html, "data-help-preview-recipient") === "강사-김하나", "recipient shown");
  ok(attrText(html, 'data-help-preview-size="question"') === `내가 쓴 질문 · ${bytes(question)} 바이트`, "question size: " + attrText(html, 'data-help-preview-size="question"'));
  ok(attrText(html, 'data-help-preview-size="prompt"') === `내가 AI에게 보낸 말 · ${bytes(prompt)} 바이트`, "prompt size");
  ok(attrText(html, "data-help-preview-excluded") === EXCLUDED, "the exclusion line, literally: " + attrText(html, "data-help-preview-excluded"));
  ok(/<p class="hp-outbound-excluded"[^>]*data-help-preview-excluded/.test(html), "the exclusion line uses the body-size class, not the 12px caption");
  const box = /<input[^>]*data-help-consent[^>]*>/.exec(html)?.[0] ?? "";
  ok(box && !/checked/.test(box), "consent box present and unchecked: " + box);
  const send = /<button[^>]*data-help-send[^>]*>/.exec(html)?.[0] ?? "";
  ok(/disabled/.test(send), "send disabled until consent: " + send);
});

const payload = { format: "hps-local-submission/1", kind: "submission", revision: 2, purpose: "포트폴리오 정리", observations: [{ k: 1 }], reviews: [], excluded: ["x"], destination: "local-inbox" };
const card = { task: { id: "t1" }, receipts: [{ revision: 1, id: "rcpt-1", accepted_at: 0, digest: "d1", destination: "local-inbox" }] } as never;
t("R2 나의 변화 기록 submit area: destination, sized parts, literal exclusion line, Korean-only learner copy", () => {
  const html = renderToStaticMarkup(<SubmissionArea card={card} preview={{ payload, digest: "abc123" } as never} include={false} busy={false} onInclude={() => {}} onPreview={() => {}} onSubmit={() => {}} onCancel={() => {}} />);
  ok(html.includes("받는 곳: 이 기기의 검토함"), "destination");
  ok(attrText(html, 'data-submission-item="purpose"') === `작업 목적 · ${bytes(JSON.stringify(payload.purpose))} 바이트`, "sized part: " + attrText(html, 'data-submission-item="purpose"'));
  ok(attrText(html, "data-submission-excluded") === EXCLUDED, "exclusion line");
  ok(attrText(html, "data-submission-submit") === "확인하고 제출" && attrText(html, "data-submission-cancel") === "취소", "확인하고 제출 / 취소");
  const copy = decode(html.replace(/<pre>[\s\S]*?<\/pre>/g, "").replace(/<code>[\s\S]*?<\/code>/g, "").replace(/<[^>]+>/g, " "));
  const english = copy.match(/[A-Za-z]{2,}/g)?.filter((w) => !["rcpt", "AI"].includes(w)) ?? [];
  ok(english.length === 0, "no English learner copy in the submit area: " + english.join(", "));
});

type Node_ = { localName: string; findAll(test: (e: Node_) => boolean): Node_[]; checked?: boolean; hasAttribute(n: string): boolean; getAttribute(n: string): string | null; textContent: string };
// mini-dom has no `type` property; React reads it to treat the input as a checkbox.
const tick = async (box: Node_) => { await act(async () => { (box as unknown as { type: string }).type = "checkbox"; box.checked = true; click(box); }); };
const withAttr = (root: Node_, attr: string) => root.findAll((e) => e.hasAttribute(attr));
const envelopeIn = (state: string) => ({ ...(view as unknown as { envelope: object }).envelope, state });

t("R3 help re-ask: a ticked consent box is unticked when the envelope goes unknown -> prepared (retry), send disabled", async () => {
  const host = mountPoint() as unknown as Node_, root = createRoot(host as never);
  const show = async (state: string) => { await act(async () => { root.render(<HelpRequest view={{ ...(view as object), envelope: envelopeIn(state) } as never} post={() => {}} />); }); };
  await show("prepared");
  let box = withAttr(host, "data-help-consent")[0], send = withAttr(host, "data-help-send")[0];
  ok(box && !box.checked && send.hasAttribute("disabled"), "fixture: first preview is unticked with send disabled");
  await tick(box);
  box = withAttr(host, "data-help-consent")[0]; send = withAttr(host, "data-help-send")[0];
  ok(box.checked === true && !send.hasAttribute("disabled"), "positive control: ticking enables send, so the reset below is observable");
  await show("unknown");
  await show("prepared");
  box = withAttr(host, "data-help-consent")[0]; send = withAttr(host, "data-help-send")[0];
  ok(box, "the re-ask shows the consent box");
  ok(box.checked !== true, "the re-asked preview must not keep the old tick");
  ok(send.hasAttribute("disabled"), "send is disabled again until the learner consents anew");
  await act(async () => { root.unmount(); });
});

const taskCard = (id: string) => ({ task: { id, project: "/p", status: "open", purpose_state: "none" }, source: { host: "claude-code", session: "s", digest: "d", evidence: "captured-replay", limitations: [], exclusions: [] },
  observations: [], interpretation: { versions: { capability_model: { id: "m", revision: 1 } }, findings: [] }, reviews: [], receipts: [], improvements: [] });
const msg = (data: object) => (globalThis.window as unknown as { dispatchEvent(e: object): void }).dispatchEvent({ type: "message", data, bubbles: false, preventDefault() {}, stopPropagation() {} });

t("R4 나의 변화 기록: changing 'include conversation text' drops the preview that no longer matches the bundle", async () => {
  const host = mountPoint() as unknown as Node_, root = createRoot(host as never);
  await act(async () => { root.render(<LocalReview />); });
  await act(async () => { msg({ type: "localReviewState", tasks: [{ id: "t1", project: "/p", status: "open" }], storage: "", card: taskCard("t1"), preview: { payload, digest: "abc123" } }); });
  ok(withAttr(host, "data-submission-preview").length === 1, "fixture: the preview is shown");
  const box = host.findAll((e) => e.localName === "input" && e.getAttribute("type") === "checkbox" && e.hasAttribute("checked") === false)
    .find((e) => (e as unknown as { parentNode: Node_ }).parentNode.textContent.includes("가져온 대화 글도 함께 넣기"));
  ok(box, "fixture: the include checkbox exists");
  await tick(box as Node_);
  ok(withAttr(host, "data-submission-preview").length === 0, "the old preview is gone after the include option changed");
  await act(async () => { root.unmount(); });
});

(async () => {
  for (const [label, fn] of tests) { try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } }
  if (fail) { console.error(`${fail} outbound render check(s) failed`); process.exit(1); }
  console.log("PASS outbound confirmation renders: help preview (and re-ask) and 나의 변화 기록 submit area (and preview refresh)");
  process.exit(0); // the mounted components leave timers (help polling) behind
})();
