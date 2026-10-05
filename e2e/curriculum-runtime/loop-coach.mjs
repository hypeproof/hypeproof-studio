// cr-e2e (#1400) — the scripted model's part of the PRD §14 loop (loop-app.spec.ts and the dev kit),
// for app-service.mjs. Owned by cr-e2e and pinned in its verification inputs: the loop's verdicts
// depend on these answers, so an edit here reopens cr-e2e's evidence. app-service.mjs only routes the
// tagged requests and the two skill prompts here.
//
//   [cr:observe]     step 2: open the student's preview and observe it once
//   [cr:edit]        step 3: make the element the student picked bigger
//   [cr:apply]       step 13: apply the team's decision as v1 (one more line on the drink screen)
//   evidence@…       step 10: sort what the prompt's records say; every observation cites them
//   deck-builder@…   step 15: patches for the slides the named decision affects, citing its usable
//                    evidence. A planted extra slide (`state.deckPlant`, one answer only) is the
//                    negative control the Service's output gate must refuse (deck_patches_affected_only).
//
// The [cr:edit] and [cr:apply] answers carry the whole page in an html fence, as a coach does in the
// proxy runtime, and the App saves it as index.html. Every answer is computed only from what reached the
// model through the App and the Service: nothing here proves a real model's judgement.
import { readFileSync } from "node:fs";

const KIOSK = new URL("./fixtures/kiosk-practice/index.html", import.meta.url);

/** The v5 deck's slide titles (CR-54), for the Deck Builder's patches. */
export const SLIDE_TITLES = { 1: "문제·기회", 2: "제공 가치", 3: "해결 원리 — AI / Human / Safety", 4: "수익 구조와 임팩트", 5: "현장·고객 접근", 6: "기존 도움과 대안", 7: "재무·임팩트 지표", 8: "현재 성과와 다음 계획" };

/**
 * The §14 coach over app-service's shared `state` (observations, edits, skills, lastHtml, deckPlant)
 * and its message readers.
 */
export function createLoopCoach(state, { blocks, textOf }) {
  /**
   * Step 2: open the student's preview and observe it once. What the App sent back is kept as the
   * model read it (header lines of the observation and whether a screenshot came with it).
   */
  function observeOnce(body, msgs, after) {
    const round = after.filter((m) => m.role === "assistant").length;
    if (round === 0) {
      const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(JSON.stringify(body.system ?? "") + JSON.stringify(msgs))?.[0];
      if (!origin) return { text: "[로컬 시험 응답] 미리보기 주소를 받지 못했어요." };
      return { tool: "browser_navigate", input: { url: `${origin}/` } };
    }
    const last = blocks(after.at(-1)?.content).find((b) => b.type === "tool_result");
    if (round === 1) return last?.is_error === true ? { text: "[로컬 시험 응답] 미리보기를 열지 못했어요." } : { tool: "browser_observe", input: {} };
    const text = textOf(last?.content);
    const field = (label) => new RegExp(`^${label}: (.*)$`, "m").exec(text)?.[1] ?? null;
    state.observations.push({
      at: Date.now(),
      is_error: last?.is_error === true,
      url: field("URL"),
      route: field("경로"),
      viewport: field("뷰포트"),
      generation: field("문서 세대"),
      version: /^산출물 버전: (sha256:[0-9a-f]{64})/m.exec(text)?.[1] ?? null,
      refs: (text.match(/\[ref=e\d+\]/g) ?? []).length,
      buttons: [...text.matchAll(/\[ref=e\d+\] button "([^"]+)"/g)].map((m) => m[1]),
      screenshot: blocks(last?.content).some((b) => b.type === "image" || b.type === "image_url"),
    });
    return { text: "[로컬 시험 응답] 지금 화면을 봤어요." };
  }

  /** The page the coach last wrote in this conversation (its own html fence), else the kiosk as it was handed out. */
  function lastPage(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role !== "assistant") continue;
      const m = /```html\n([\s\S]*?)\n```/.exec(textOf(history[i].content));
      if (m) return m[1];
    }
    // The App may send a clamped history; the coach's own last page is then the one it wrote last in this run.
    return state.lastHtml ?? readFileSync(KIOSK, "utf8");
  }

  /**
   * Step 3 (`[cr:edit]`): make the element the student picked bigger. The element is read from the
   * payload the App put before the student's words (its HTML snippet's id); nothing is guessed when it
   * is missing. Step 13 (`[cr:apply]`): the team's decision as v1, one more line on the drink screen.
   */
  function editAnswer(userText, history) {
    const base = lastPage(history);
    const body = base.indexOf("<body");
    let html;
    if (/\[cr:edit\]/.test(userText)) {
      const id = /^HTML(?: \(앞부분\))?:\n<[a-z][a-z0-9-]*\b[^>]*\bid="([^"]+)"/m.exec(userText)?.[1];
      if (!id || body < 0) return "[로컬 시험 응답] 어느 요소를 고쳐야 할지 받지 못했어요.";
      const open = new RegExp(`<([a-z][a-z0-9-]*)\\b([^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*)>`);
      const rest = base.slice(body);
      if (!open.test(rest)) return `[로컬 시험 응답] ${id} 요소를 페이지에서 찾지 못했어요.`;
      html = base.slice(0, body) + rest.replace(open, (_m, tag, attrs) => `<${tag}${attrs.replace(/\sclass="[^"]*"/, "")} class="big">`);
      if (!html.includes(".big{")) html = html.replace("</head>", "  <style>.big{font-size:1.5em;padding:18px 32px}</style>\n</head>");
      state.edits.push({ kind: "edit", element: id, at: Date.now() });
      state.lastHtml = html;
      return `[로컬 시험 응답] 고른 요소를 더 크게 고쳤어요.\n\`\`\`html\n${html}\n\`\`\``;
    }
    const label = '<label for="drink">음료 고르기</label>';
    if (!base.includes(label)) return "[로컬 시험 응답] 음료 고르는 화면을 찾지 못했어요.";
    html = base.replace(label, `${label}\n    <p class="hint">음료와 수량을 이 화면에서 한 번에 골라요.</p>`);
    state.edits.push({ kind: "apply", at: Date.now() });
    state.lastHtml = html;
    return `[로컬 시험 응답] 결정대로 한 화면에서 고르게 고쳤어요.\n\`\`\`html\n${html}\n\`\`\``;
  }

  /** Step 10: the Evidence skill sorts what the prompt's records say; every observation cites them. */
  function evidenceAnswer(context) {
    const rec = context.experiment_records ?? {};
    const sessions = Array.isArray(rec.sessions) ? rec.sessions : [];
    const notes = Array.isArray(rec.notes) ? rec.notes : [];
    const items = [];
    if (sessions.length) {
      const pages = sessions.reduce((n, s) => n + (Number(s.pages) || 0), 0);
      const clicks = sessions.reduce((n, s) => n + (Number(s.clicks) || 0), 0);
      items.push({ id: "o1", section: "observation", text: `참가 세션 ${sessions.length}개에서 화면을 ${pages}번 보고 ${clicks}번 눌렀다`, source_refs: [...sessions.map((s) => s.ref), ...sessions.flatMap((s) => (s.event_refs ?? []).slice(0, 10))] });
    }
    notes.forEach((n, i) => items.push({ id: `o${i + 2}`, section: "observation", text: String(n.text), source_refs: [n.ref] }));
    if (notes.length) items.push({ id: "i1", section: "interpretation", text: "음료를 고르는 화면이 처음 쓰는 사람에게 낯설다", source_refs: [notes[0].ref] });
    items.push({ id: "a1", section: "assumption", text: "음료와 수량을 한 화면에서 고르면 도움 없이 주문을 마칠 수 있다", source_refs: [] });
    items.push({ id: "n1", section: "next_experiment", text: "한 화면 버전으로 다섯 명에게 주문을 부탁한다", source_refs: [] });
    state.skills.at(-1).cited = items.flatMap((i) => i.source_refs);
    return "```json\n" + JSON.stringify({ items }) + "\n```";
  }

  /**
   * Step 15: the Deck Builder patches only the slides the named decision affects, citing its usable
   * evidence. With `state.deckPlant` set (a slide number), this one answer also patches that slide: the
   * planted defect the Service's gate must refuse. The plant is used up by the answer it changes.
   */
  function deckBuilderAnswer(context, input) {
    const d = (context.decisions ?? []).find((x) => x.id === input.decision_id);
    if (!d) return "{}";
    const usable = new Set((context.evidence_items ?? []).filter((i) => !i.pending_review && i.sources_real !== false && i.confidence !== "assumed").map((i) => i.id));
    const refs = (d.evidence_refs ?? []).filter((r) => usable.has(r));
    const slides = [...(d.affected_deck_slides ?? [])];
    const planted = typeof state.deckPlant === "number" ? state.deckPlant : null;
    state.deckPlant = null;
    if (planted !== null) slides.push(planted);
    const patches = slides.map((n) => ({ slide: n, title: SLIDE_TITLES[n] ?? `슬라이드 ${n}`, body: `${d.statement} — 근거 ${refs.length}개`, evidence_refs: refs }));
    Object.assign(state.skills.at(-1), { patches: patches.map((p) => ({ slide: p.slide, evidence_refs: p.evidence_refs })), planted });
    return "```json\n" + JSON.stringify({ patches, rationale: "결정이 바꾸는 슬라이드만 고쳤어요." }) + "\n```";
  }

  return { observeOnce, editAnswer, evidenceAnswer, deckBuilderAnswer };
}
