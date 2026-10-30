import { staticTokens } from "./lib/expand-design-tokens.mjs";
import { readFileSync } from "node:fs";
// CGP-KNOW-R-003 (REQ-STUDIO-ACTIVITY-MATERIALS) — the 자료 list in the coach rail and the
// "함께 보낼 자료" line above the composer. Mounted with react-dom/client on the minimal DOM
// (fixtures/mini-dom.mjs) and driven by real clicks; the host is played by window messages, and
// every press is read from what the webview posted. The CSS half parses the real stylesheet into
// rules, resolves the --hp-*/--ds-* tokens to pixels, and runs each check against a mutated copy
// that must fail.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { MaterialsChips, MaterialsPanel } from "../webview-ui/src/MaterialsPanel";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { MATERIALS_COPY, type MaterialsView } from "../src/activityMaterialsView";
import type { ChatConfig } from "../src/protocol";

const posted = (globalThis as unknown as { __posted: Record<string, unknown>[] }).__posted;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = { localName: string; textContent: string; value: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean };
const all = (test: (e: El) => boolean) => (doc as unknown as { documentElement: El }).documentElement.findAll(test);
const byText = (tag: string, text: string) => all((e) => e.localName === tag && e.textContent === text);
const hostSays = (data: unknown) => act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", data, bubbles: false }); });
const ev = (type: string) => ({ type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
const last = (type: string) => posted.filter((m) => m.type === type).at(-1);

const item = (over: Partial<MaterialsView["items"][number]>) => ({ kind: "file", detail: "", selected: false, removable: true, origin: "learner", originLabel: "나", ...over }) as MaterialsView["items"][number];
const VIEW: MaterialsView = {
  scope: "[\"a1\",\"task-a\"]", maxSelected: 3,
  items: [
    item({ id: "inbox:obj-12345678:1", kind: "note", title: "강사 읽기 자료", detail: "강사가 보낸 글", origin: "instructor", originLabel: "강사", removable: false }),
    item({ id: "me:aaaaaaaaaaaa", title: "아주 긴 한국어 자료 제목이 좁은 칸에서도 잘리지 않아야 한다.md", detail: "자료/아주 긴 한국어 자료 제목이 좁은 칸에서도 잘리지 않아야 한다.md" }),
    item({ id: "me:bbbbbbbbbbbb", kind: "url", title: "example.com", detail: "https://example.com/a" }),
    item({ id: "ai:자료/요약.md", title: "요약.md", detail: "자료/요약.md", origin: "ai", originLabel: "AI" }),
  ],
};

async function mountPanel() {
  const root = createRoot(mountPoint() as never);
  posted.length = 0;
  await act(async () => { root.render(<><MaterialsPanel /><MaterialsChips /></>); });
  return root;
}

t("asks the host for the list and draws nothing until it answers", async () => {
  const root = await mountPanel();
  ok(posted.some((m) => m.type === "materialsRequest"), "materialsRequest posted");
  eq(all((e) => e.getAttribute("data-testid") === "materials").length, 0, "no panel before the host answers");
  await act(async () => { root.unmount(); });
});

t("every item says who added it in words: 나, 강사, AI; never pre-selected", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const metas = all((e) => e.localName === "span" && (e.getAttribute("class") ?? "") === "hp-materials-origin" && e.textContent.startsWith("추가:")).map((e) => e.textContent);
  eq(metas, ["추가: 강사", "추가: 나", "추가: 나", "추가: AI"], "origin words");
  eq(all((e) => e.localName === "li" && e.hasAttribute("data-material-origin")).map((e) => e.getAttribute("data-material-origin")), ["instructor", "learner", "learner", "ai"], "origin per row");
  ok(byText("span", VIEW.items[1].title).length === 1, "the long Korean title is drawn whole");
  ok(all((e) => e.localName === "button" && e.getAttribute("aria-pressed") === "true").length === 0, "nothing pre-selected");
  ok(byText("summary", "자료 4개").length === 1, "summary counts the list");
  ok(byText("p", MATERIALS_COPY.note).length === 1, "says only selected items are sent");
  await act(async () => { root.unmount(); });
});

t("an instructor item has no 목록에서 빼기 and says why; learner and AI items have it", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const removes = all((e) => e.localName === "button" && e.hasAttribute("data-material-remove")).map((e) => e.getAttribute("aria-label"));
  eq(removes, [`목록에서 빼기: ${VIEW.items[1].title}`, "목록에서 빼기: example.com", "목록에서 빼기: 요약.md"], "remove only on removable rows");
  ok(byText("span", MATERIALS_COPY.instructorLocked).length === 1, "instructor lock said in words");
  await act(async () => { root.unmount(); });
});

t("이번 질문에 넣기 asks the host to select that item for this list's scope; nothing is sent", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const pick = all((e) => e.localName === "button" && e.getAttribute("aria-label") === "이번 질문에 넣기: example.com")[0];
  ok(pick, "select button names the item");
  await act(async () => { click(pick); });
  const sel = last("materialSelect") as { scope: string; id: string; selected: boolean; requestId: string };
  eq([sel.scope, sel.id, sel.selected], [VIEW.scope, "me:bbbbbbbbbbbb", true], "select message");
  ok(!posted.some((m) => m.type === "sendMessage"), "nothing sent");
  // The host's answer to that press marks it selected, and the composer line names it.
  const selected = { ...VIEW, items: VIEW.items.map((i) => i.id === "me:bbbbbbbbbbbb" ? { ...i, selected: true } : i) };
  await hostSays({ type: "materialsState", view: selected, requestId: sel.requestId });
  ok(all((e) => e.localName === "button" && e.getAttribute("aria-label") === "넣음: example.com" && e.getAttribute("aria-pressed") === "true").length === 1, "pressed state from the host");
  const chips = all((e) => e.getAttribute("data-testid") === "materials-chips")[0];
  ok(chips && chips.textContent.includes("example.com · 추가: 나"), "composer line names the item and its origin");
  ok(byText("summary", "자료 4개 · 이번 질문에 1개 넣음").length === 1, "summary says how many go");
  const out = all((e) => e.localName === "button" && e.getAttribute("aria-label") === "example.com 빼기")[0];
  await act(async () => { click(out); });
  eq((last("materialSelect") as { selected: boolean; id: string }).selected, false, "빼기 on the chip deselects");
  await act(async () => { root.unmount(); });
});

t("a selected item that is gone is named above the composer with why, before Send, and 빼기 takes it out", async () => {
  const root = await mountPanel();
  const gone = { ...VIEW, items: VIEW.items.map((i) => i.id === "me:bbbbbbbbbbbb" ? { ...i, selected: true } : i), unavailable: [{ id: "me:cccccccccccc", title: "지운 계획.md", reason: MATERIALS_COPY.goneReason }] };
  await hostSays({ type: "materialsState", view: gone });
  const chips = all((e) => e.getAttribute("data-testid") === "materials-chips")[0];
  ok(chips, "the composer line is drawn");
  ok(chips.textContent.includes("example.com · 추가: 나"), "the item that can go is listed");
  ok(chips.textContent.includes(`지운 계획.md · 보낼 수 없음: ${MATERIALS_COPY.goneReason}`), "the gone item is named with why");
  ok(all((e) => e.getAttribute("role") === "alert" && e.textContent === MATERIALS_COPY.unavailableNote).length === 1, "the learner is told it must be taken out to send");
  const out = all((e) => e.localName === "button" && e.getAttribute("aria-label") === "지운 계획.md 빼기 (보낼 수 없는 자료)")[0];
  ok(out, "the gone item has its own 빼기");
  await act(async () => { click(out); });
  const sel = last("materialSelect") as { id: string; selected: boolean };
  eq([sel.id, sel.selected], ["me:cccccccccccc", false], "빼기 deselects the gone item");
  ok(!posted.some((m) => m.type === "sendMessage"), "nothing sent");
  await act(async () => { root.unmount(); });
});

t("only a gone item selected: the line is still drawn, so it is never silently dropped", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: { ...VIEW, unavailable: [{ id: "me:cccccccccccc", title: "지운 계획.md", reason: MATERIALS_COPY.goneReason }] } });
  ok(all((e) => e.getAttribute("data-testid") === "materials-chips").length === 1, "drawn with no sendable item");
  await act(async () => { root.unmount(); });
});

t("adding: 파일 넣기 asks the host's picker; an address is posted as typed; a refusal shows as an alert", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  await act(async () => { click(all((e) => e.localName === "button" && e.hasAttribute("data-material-add-file"))[0]); });
  const fileReq = last("materialAddFile") as { requestId: string };
  ok(fileReq, "materialAddFile posted");
  await hostSays({ type: "materialsState", view: VIEW, requestId: fileReq.requestId });
  const input = all((e) => e.localName === "input" && e.getAttribute("name") === "material-url")[0];
  ok(input && input.getAttribute("type") === "url", "address field");
  // mini-dom does not reflect the type attribute to the property React's change plugin reads.
  (input as unknown as { type: string }).type = input.getAttribute("type")!;
  await act(async () => { input.value = "http://example.com"; input.dispatchEvent(ev("input")); });
  const form = all((e) => e.localName === "form")[0];
  const submit = all((e) => e.localName === "button" && e.getAttribute("type") === "submit")[0];
  ok(!submit.hasAttribute("disabled"), "주소 넣기 enabled once an address is typed");
  await act(async () => { form.dispatchEvent(ev("submit")); });
  const urlReq = last("materialAddUrl") as { url: string; requestId: string };
  eq(urlReq?.url, "http://example.com", "posted as typed; the host decides");
  const reason = "https:// 로 시작하는 주소만 넣을 수 있어요. 암호화되지 않은 http 주소나 다른 종류의 주소는 넣지 않아요.";
  await hostSays({ type: "materialsState", view: VIEW, requestId: urlReq.requestId, error: reason });
  ok(all((e) => e.getAttribute("role") === "alert" && e.textContent === reason).length === 1, "refusal reason shown");
  await act(async () => { root.unmount(); });
});

// ── #2641: one file dropped on the open card goes to the host as bytes, the way 파일 넣기 sends a pick. ──
type FakeFile = { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> };
type Drag = ReturnType<typeof ev> & { _stopped: boolean; relatedTarget: unknown; dataTransfer: { items: { kind: string }[]; files: FakeFile[] } };
const textFile = (name: string, text: string): FakeFile => {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, type: "text/markdown", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const drag = (type: string, files: FakeFile[], kind = "file"): Drag => ({
  ...ev(type), _stopped: false, stopPropagation() { this._stopped = true; }, relatedTarget: null,
  dataTransfer: { items: files.length ? files.map(() => ({ kind })) : [{ kind: "string" }], files },
});
t("#3266: note draft survives refusal and unrelated replies, then clears on its own success", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const field = (name: string) => all(e => e.getAttribute("name") === name)[0];
  const form = all(e => e.localName === "form" && e.findAll(c => c.getAttribute("name") === "material-note-title").length > 0)[0];
  await act(async () => { const e = field("material-note-title"); (e as unknown as { type: string }).type = "text"; e.value = "수업 메모"; e.dispatchEvent(ev("input")); });
  await act(async () => { const e = field("material-note-text"); e.value = "직접 쓴 내용\n둘째 줄"; e.dispatchEvent(ev("input")); });
  await act(async () => { form.dispatchEvent(ev("submit")); });
  const first = last("materialAddNote")!;
  eq([first.scope, first.title, first.text], [VIEW.scope, "수업 메모", "직접 쓴 내용\n둘째 줄"], "authored text and scope posted exactly");
  ok(!posted.some(m => m.type === "sendMessage" || m.type === "materialSelect"), "save does not send or select");
  await hostSays({ type: "materialsState", view: VIEW, requestId: "another-surface" });
  eq(field("material-note-text").value, "직접 쓴 내용\n둘째 줄", "unrelated success preserves draft");
  await hostSays({ type: "materialsState", view: VIEW, requestId: first.requestId, error: "저장하지 못했어요" });
  eq(field("material-note-title").value, "수업 메모", "refusal preserves title");
  eq(field("material-note-text").value, "직접 쓴 내용\n둘째 줄", "refusal preserves body");
  await act(async () => { form.dispatchEvent(ev("submit")); });
  const second = last("materialAddNote")!;
  ok(second.requestId !== first.requestId, "retry has own acknowledgement");
  await hostSays({ type: "materialsState", view: VIEW, requestId: second.requestId });
  eq([field("material-note-title").value, field("material-note-text").value], ["", ""], "own success clears saved draft");
  await act(async () => { root.unmount(); });
});

t("#3266: a different activity never inherits the note draft", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const title = () => all(e => e.getAttribute("name") === "material-note-title")[0];
  await act(async () => { const e = title(); (e as unknown as { type: string }).type = "text"; e.value = "첫 활동의 비공개 메모"; e.dispatchEvent(ev("input")); });
  await hostSays({ type: "materialsState", view: { ...VIEW, scope: "different-task" } });
  eq(title().value, "", "new activity starts empty");
  await act(async () => { const e = title(); (e as unknown as { type: string }).type = "text"; e.value = "두 번째 활동"; e.dispatchEvent(ev("input")); });
  await hostSays({ type: "materialsState", view: VIEW });
  eq(title().value, "", "second activity text never leaks back");
  await act(async () => { root.unmount(); });
});


// Pending note requests belong to their original material scope.
for (const transition of ["same", "switch", "return", "unavailable"]) t(`#3266 pending note after ${transition}`, async () => {
  const root = await mountPanel();
  try {
    await hostSays({ type: "materialsState", view: VIEW });
    const field = (name: string) => all(e => e.getAttribute("name") === name)[0];
    const form = all(e => e.localName === "form" && e.findAll(c => c.getAttribute("name") === "material-note-title").length > 0)[0];
    await act(async () => { const e = field("material-note-title"); (e as unknown as { type: string }).type = "text"; e.value = "첫 활동 메모"; e.dispatchEvent(ev("input")); });
    await act(async () => { const e = field("material-note-text"); e.value = "응답 전 활동 이동"; e.dispatchEvent(ev("input")); });
    await act(async () => { form.dispatchEvent(ev("submit")); });
    const request = last("materialAddNote")!;
    ok(request?.requestId, "note request issued");
    ok(field("material-note-title").hasAttribute("disabled"), "pending same scope disabled positive control");
    const other = { ...VIEW, scope: "task-b" };
    if (transition === "same") {
      await hostSays({ type: "materialsState", view: VIEW });
      ok(field("material-note-title").hasAttribute("disabled"), "same scope refresh cannot duplicate save");
      await hostSays({ type: "materialsState", view: VIEW, requestId: request.requestId });
    } else if (transition === "switch") {
      await hostSays({ type: "materialsState", view: other });
    } else if (transition === "return") {
      await hostSays({ type: "materialsState", view: other });
      await hostSays({ type: "materialsState", view: VIEW });
    } else {
      await hostSays({ type: "materialsState", view: null });
      await hostSays({ type: "materialsState", view: other });
    }
    ok(!field("material-note-title").hasAttribute("disabled"), "active scope note input must be usable without old-scope acknowledgement");
    const button = all(e => e.localName === "button" && e.getAttribute("aria-label") === "이번 질문에 넣기: example.com")[0];
    ok(!button.hasAttribute("disabled"), "active scope source selection must be usable");
    await act(async () => { click(button as never); });
    const select = last("materialSelect")!;
    eq(select.scope, transition === "switch" || transition === "unavailable" ? "task-b" : VIEW.scope, "new request uses displayed scope");
    ok(select.requestId !== request.requestId, "new operation has own acknowledgement");
    const currentView = transition === "switch" || transition === "unavailable" ? other : VIEW;
    await hostSays({ type: "materialsState", view: currentView, requestId: request.requestId, error: "이전 요청 오류" });
    ok(field("material-note-title").hasAttribute("disabled"), "old reply cannot unlock a newer request");
    ok(!byText("p", "이전 요청 오류").length, "old reply cannot show an error in new scope");
    await hostSays({ type: "materialsState", view: currentView, requestId: select.requestId });
    ok(!field("material-note-title").hasAttribute("disabled"), "new request unlocks only on own reply");
  } finally { await act(async () => { root.unmount(); }); }
});

type Card = El & { open: boolean; dispatchEvent(e: unknown): boolean };
const card = () => all((e) => e.getAttribute("data-testid") === "materials")[0] as unknown as Card;
const settle = () => new Promise((r) => setTimeout(r, 0));
const drops = () => posted.filter((m) => m.type === "materialAddDrop") as { name: string; size: number; base64: string; requestId: string }[];

for (const transition of ["same", "switch", "return", "unavailable", "unmount"]) t(`#3306: delayed drop settles safely after ${transition}`, async () => {
  for (const rejects of [false, true]) {
    const root = await mountPanel();
    await hostSays({ type: "materialsState", view: VIEW });
    let resolve!: (value: ArrayBuffer) => void, reject!: (reason: Error) => void;
    const reading = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no; });
    const file: FakeFile = { name: "private.md", size: 3, type: "text/markdown", arrayBuffer: () => reading };
    const c = card(); c.open = true;
    await act(async () => { c.dispatchEvent(drag("drop", [file])); });
    if (transition === "unmount") await act(async () => { root.unmount(); });
    else if (transition === "unavailable") await hostSays({ type: "materialsState", view: null });
    else {
      await hostSays({ type: "materialsState", view: transition === "same" ? { ...VIEW } : { ...VIEW, scope: "other-task" } });
      if (transition === "return") await hostSays({ type: "materialsState", view: VIEW });
    }
    await act(async () => { if (rejects) reject(new Error("read failed")); else resolve(new Uint8Array([97, 98, 99]).buffer); await settle(); await settle(); });
    const sent = drops();
    if (transition !== "unmount") await act(async () => { root.unmount(); });
    eq(sent.length, transition === "same" ? 1 : 0, `old read ${rejects ? "rejection" : "bytes"} must not cross ${transition}`);
    if (transition === "same") eq(sent[0].base64, rejects ? "" : "YWJj", "unchanged scope retains normal success/refusal path");
  }
});

t("#2641: a file dropped on the open card goes to the host once, as its bytes, and stops at the card", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const c = card(); c.open = true;
  const over = drag("dragover", [textFile("메모.md", "# 메모\n")]);
  await act(async () => { c.dispatchEvent(over); });
  ok(over.defaultPrevented && over._stopped, "a file over the open card is taken, not passed on");
  ok(c.hasAttribute("data-drop-active"), "the card is marked for its outline while a file is over it");
  const drop = drag("drop", [textFile("메모.md", "# 메모\n")]);
  await act(async () => { c.dispatchEvent(drop); await settle(); });
  ok(drop.defaultPrevented && drop._stopped, "the drop stops at the card");
  ok(!c.hasAttribute("data-drop-active"), "the outline goes with the drop");
  eq(drops().map((m) => [m.name, m.size, Buffer.from(m.base64, "base64").toString("utf8")]), [["메모.md", 9, "# 메모\n"]], "one message with the file's bytes");
  await act(async () => { root.unmount(); });
});

t("#2641: several files in one drop are refused with one message, and nothing goes to the host", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const c = card(); c.open = true;
  const drop = drag("drop", [textFile("a.md", "a"), textFile("b.md", "b")]);
  await act(async () => { c.dispatchEvent(drop); await settle(); });
  ok(drop.defaultPrevented && drop._stopped, "still taken, so the shell does not attach them");
  eq(drops().length, 0, "nothing sent to the host");
  ok(all((e) => e.getAttribute("role") === "alert" && e.textContent === MATERIALS_COPY.dropOne).length === 1, "one refusal, in words");
  await act(async () => { root.unmount(); });
});

t("#2641: the closed card is not a drop target, and a text drag over the open card is not taken", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const c = card(); c.open = false;
  for (const type of ["dragover", "drop"]) {
    const e = drag(type, [textFile("a.md", "a")]);
    await act(async () => { c.dispatchEvent(e); await settle(); });
    ok(!e.defaultPrevented && !e._stopped, `closed card: ${type} passes on to the shell`);
  }
  c.open = true;
  const text = drag("dragover", []);
  await act(async () => { c.dispatchEvent(text); });
  ok(!text.defaultPrevented && !c.hasAttribute("data-drop-active"), "a text drag is not a file drop");
  eq(drops().length, 0, "nothing sent");
  await act(async () => { root.unmount(); });
});

t("#2641: a file over the cap is never read; the host gets only its name and size", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const c = card(); c.open = true;
  const big: FakeFile = { name: "큰 파일.md", size: 100 * 1024 + 1, type: "text/markdown", arrayBuffer: () => { throw new Error("the bytes were read"); } };
  await act(async () => { c.dispatchEvent(drag("drop", [big])); await settle(); });
  eq(drops().map((m) => [m.name, m.size, m.base64]), [["큰 파일.md", 100 * 1024 + 1, ""]], "name and size only");
  await act(async () => { root.unmount(); });
});

t("#2641: a file whose read fails still gets an answer: the host gets its name and size, no bytes", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const c = card(); c.open = true;
  // A folder dragged from the file manager is a File whose bytes cannot be read.
  const folder: FakeFile = { name: "폴더", size: 96, type: "", arrayBuffer: () => Promise.reject(new Error("NotReadableError")) };
  await act(async () => { c.dispatchEvent(drag("drop", [folder])); await settle(); await settle(); });
  eq(drops().map((m) => [m.name, m.size, m.base64]), [["폴더", 96, ""]], "sent with no bytes, so the host answers unreadable");
  await act(async () => { root.unmount(); });
});

t("#2641: a drop while another 자료 request is pending sends nothing", async () => {
  const root = await mountPanel();
  await hostSays({ type: "materialsState", view: VIEW });
  const c = card(); c.open = true;
  await act(async () => { c.dispatchEvent(drag("drop", [textFile("a.md", "a")])); await settle(); });
  await act(async () => { c.dispatchEvent(drag("drop", [textFile("b.md", "b")])); await settle(); });
  eq(drops().map((m) => m.name), ["a.md"], "only the first drop went to the host");
  await act(async () => { root.unmount(); });
});


t("ChatPanel draws the list only with the host's materials flag, never for an instructor", async () => {
  const UX = { coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } }, retry_button: { enabled: false, show_counter: false } };
  const base = { model: "m", hasToken: true, proxyUrl: "http://localhost:8787", fileAttach: true, coach: { name: "HypeProof", personality: "", configured: true },
    profile: { profile_id: "p", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX } };
  const noop = () => {};
  const props = { messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false, pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop, onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop, onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop };
  for (const [label, config, instructor, want] of [["granted learner", { ...base, materials: true }, false, 1], ["no flag", base, false, 0], ["instructor", { ...base, materials: true }, true, 0]] as const) {
    posted.length = 0;
    const root = createRoot(mountPoint() as never);
    await act(async () => { root.render(<ChatPanel {...(props as never)} config={config as unknown as ChatConfig} instructor={instructor} />); });
    await hostSays({ type: "materialsState", view: VIEW });
    eq(all((e) => e.getAttribute("data-testid") === "materials").length, want, label);
    eq(posted.some((m) => m.type === "materialsRequest"), want === 1, `${label}: asks only when drawn`);
    await act(async () => { root.unmount(); });
  }
});

t("#2641: in the chat panel a drop on the open card never reaches the shell's photo drop (shell control first)", async () => {
  const UX = { coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } }, retry_button: { enabled: false, show_counter: false } };
  const config = { model: "m", hasToken: true, proxyUrl: "http://localhost:8787", fileAttach: true, materials: true, coach: { name: "HypeProof", personality: "", configured: true },
    profile: { profile_id: "p", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX, input: { image_paste: true, image_files: true } } };
  const noop = () => {};
  const props = { messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false, pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop, onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop, onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop };
  posted.length = 0;
  const root = createRoot(mountPoint() as never);
  await act(async () => { root.render(<ChatPanel {...(props as never)} config={config as unknown as ChatConfig} instructor={false} />); });
  await hostSays({ type: "materialsState", view: VIEW });
  const shell = all((e) => (e.getAttribute("class") ?? "").split(" ").includes("hps-shell"))[0] as unknown as Card;
  const dragging = () => (shell.getAttribute("class") ?? "").split(" ").includes("hps-shell-drag");
  // Control: outside the card, the shell takes the file (its photo drop is on in this config).
  await act(async () => { shell.dispatchEvent(drag("dragover", [textFile("사진.png", "x")])); });
  ok(dragging(), "control: a file over the shell shows the shell's drop overlay");
  await act(async () => { shell.dispatchEvent(drag("dragleave", [])); });
  const c = card(); c.open = true;
  await act(async () => { c.dispatchEvent(drag("dragover", [textFile("메모.md", "메모")])); });
  ok(!dragging() && c.hasAttribute("data-drop-active"), "over the card only the card is marked");
  await act(async () => { c.dispatchEvent(drag("drop", [textFile("메모.md", "메모")])); await settle(); });
  ok(!posted.some((m) => m.type === "stageImage"), "nothing was attached to the composer");
  eq(drops().map((m) => m.name), ["메모.md"], "the card sent it to the host");
  await act(async () => { root.unmount(); });
});

// ── CSS: committed rule guards, each with a mutated copy that must fail. Sizes, text and the focus ring are
// measured on the cascade in test/activity-materials-computed.smoke.mjs (headless Chromium), not here. ──
const readDesignFile = (file: string) => staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(readFileSync(file, "utf8"));
const CSS = readDesignFile("webview-ui/src/styles.css");
const TOKENS = readDesignFile("webview-ui/src/tokens.css");
function rules(raw: string) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^@import[^;]*;/gm, "");
  const out: { selectors: string[]; decls: Record<string, string>; media: string }[] = [];
  const walk = (from: number, to: number, media: string) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
      if (/^@media\b/.test(head)) walk(open + 1, j - 1, head);
      else if (!head.startsWith("@")) {
        const decls: Record<string, string> = {};
        for (const d of css.slice(open + 1, j - 1).split(";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
        out.push({ selectors: head.split(",").map((s) => s.replace(/\s+/g, " ").trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, "");
  return out;
}
const vars = new Map<string, string>();
for (const r of rules(TOKENS)) if (r.media === "" && r.selectors.includes(":root")) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith("--") && !vars.has(k)) vars.set(k, v);
/** A token or declaration as pixels (or a bare number), at the default text size. */
function px(value: string | undefined): number {
  let v = value ?? "";
  for (let n = 0; n < 20 && v.includes("var("); n++) v = v.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_m, name, fb) => vars.get(name) ?? fb ?? "NaN");
  const expr = v.replace(/calc\(/g, "(").replace(/(\d*\.?\d+)px/g, "$1");
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) return NaN;
  return Function(`return (${expr})`)() as number;
}
const decl = (css: string, selector: string, prop: string) => { let v: string | undefined; for (const r of rules(css)) if (r.media === "" && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop]; return v; };
const forcedDecl = (css: string, selector: string, prop: string) => { let v: string | undefined; for (const r of rules(css)) if (r.media.includes("forced-colors: active") && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop]; return v; };
const cssChecks: Record<string, (css: string) => string[]> = {
  "forced colours: the pressed 넣음 keeps its word (CanvasText on Canvas, Highlight border)": (css) => {
    const s = '.hp-materials button[aria-pressed="true"]';
    const want: Record<string, string> = { "background-color": "Canvas !important", color: "CanvasText !important", "border-color": "Highlight !important" };
    return Object.entries(want).filter(([k, v]) => forcedDecl(css, s, k) !== v).map(([k]) => `${k} ${forcedDecl(css, s, k)}`);
  },
  "#2641: while a file is over the open card, its border is the 2px focus ring and nothing moves": (css) => {
    const s = ".hp-materials[data-drop-active]";
    const bad: string[] = [];
    if (px(decl(css, s, "border-width") ?? "") !== 2) bad.push(`border-width ${decl(css, s, "border-width")}`);
    if (decl(css, s, "border-color") !== "var(--hp-ring-focus-default)") bad.push(`border-color ${decl(css, s, "border-color")}`);
    const resting = px(decl(css, ".hp-rail-lesson", "padding") ?? "") + px((decl(css, ".hp-rail-lesson", "border") ?? "").split(" ")[0]);
    if (px(decl(css, s, "padding") ?? "") + 2 !== resting) bad.push(`padding ${decl(css, s, "padding")} does not give the extra border back (resting ${resting}px)`);
    for (const k of ["outline", "outline-offset"]) if (decl(css, s, k) !== undefined) bad.push(`${k} is reserved for focus rings`);
    return bad;
  },
  "a title ellipsizes while the containing row stays unconstrained": (css) => {
    const bad: string[] = [];
    if (decl(css, ".hp-materials-title", "text-overflow") !== "ellipsis") bad.push("title lacks ellipsis");
    if (decl(css, ".hp-materials-title", "overflow") !== "hidden") bad.push("title overflows");
    if (decl(css, ".hp-materials-title", "white-space") !== "nowrap") bad.push("title is not one line");
    for (const s of [".hp-materials-item", ".hp-materials-chip"]) if (decl(css, s, "text-overflow") || decl(css, s, "white-space") === "nowrap") bad.push(`${s} truncates`);
    return bad;
  },
};
const MUTANTS: Record<string, (css: string) => string> = {
  "#2641: while a file is over the open card, its border is the 2px focus ring and nothing moves": (css) => css.replace(/(\.hp-materials\[data-drop-active\] \{ border-width: )[^;]+;/, "$11px;"),
  "forced colours: the pressed 넣음 keeps its word (CanvasText on Canvas, Highlight border)": (css) => css.replace('{ background-color: Canvas !important; color: CanvasText !important;', '{ color: CanvasText !important;'),
  "a title ellipsizes while the containing row stays unconstrained": (css) => css.replace(/(\.hp-materials-title \{[^}]*)white-space: nowrap;/, "$1white-space: normal;"),
};
for (const [label, check] of Object.entries(cssChecks)) {
  t(`css: ${label} (and its mutated copy fails)`, () => {
    eq(check(CSS), [], label);
    const mutated = MUTANTS[label](CSS);
    ok(mutated !== CSS, `${label}: the mutation applied`);
    ok(check(mutated).length > 0, `${label}: the mutated stylesheet still passes`);
  });
}
t("css: the tokens resolve as expected (control for the resolver)", () => {
  eq(px("var(--hp-control-min)"), 44, "control-min");
  ok(px("var(--hp-font-caption)") >= 14, "caption ≥ 14px");
  ok(Number.isNaN(px("auto")), "a keyword is not a size");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).stack ?? e}`); fail++; }
  }
  if (fail) { console.error(`activity-materials: ${fail} failed`); process.exit(1); }
  console.log("activity-materials render OK");
  process.exit(0);
})();
