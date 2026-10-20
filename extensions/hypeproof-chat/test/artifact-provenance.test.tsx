// REQ-STUDIO-ARTIFACT-PROVENANCE (CGP-KNOW-R-012) — the 작업 자료 panel draws the host's labels as text
// plus a symbol, with the history, and says so when it has nothing to show. Bundled with esbuild and
// run with plain Node, like turn-review.

import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactProvenanceList } from "../webview-ui/src/ArtifactProvenanceList";
import { TaskWorkspace } from "../webview-ui/src/TaskWorkspace";
import { emptyLedger, observeOutsideTurn, provenanceView, recordCoachTurn, recordHostWrite } from "../src/artifactProvenance";
import type { ArtifactProvenanceView } from "../src/artifactProvenanceView";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined, innerWidth: 1280 };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const has = (html: string, s: string) => { if (!html.includes(s)) throw new Error(`missing ${JSON.stringify(s)}`); };
const lacks = (html: string, s: string) => { if (html.includes(s)) throw new Error(`unexpected ${JSON.stringify(s)}`); };
const list = (view: ArtifactProvenanceView | null | undefined) => renderToStaticMarkup(<ArtifactProvenanceList view={view} />);
const h = (c: string) => c.repeat(64);

// A view made by the real derivation, not typed by hand.
let ledger = observeOutsideTurn(emptyLedger(), [{ path: "notes.md", sha256: h("n") }], { at: 1 });
ledger = recordHostWrite(ledger, [{ path: "images/외관.jpg", sha256: h("p") }], { at: 1.5, actor: "learner_upload" });
ledger = observeOutsideTurn(ledger, [{ path: "notes.md", sha256: h("n") }, { path: "images/외관.jpg", sha256: h("p") }], { at: 2 });
ledger = recordCoachTurn(ledger, { turnId: "t1", at: 3, startedAt: 2, added: ["index.html"], changed: [], deleted: [] }, [{ path: "notes.md", sha256: h("n") }, { path: "images/외관.jpg", sha256: h("p") }, { path: "index.html", sha256: h("1") }]);
ledger = recordHostWrite(ledger, [{ path: "index.html", sha256: h("2") }], { at: 3.5, actor: "learner_save" }); // the learner's editor save
ledger = observeOutsideTurn(ledger, [{ path: "notes.md", sha256: h("n") }, { path: "images/외관.jpg", sha256: h("p") }, { path: "index.html", sha256: h("2") }], { at: 4 });
const VIEW = provenanceView(ledger);

t("each file: path, symbol (decorative) and label in words", () => {
  const html = list(VIEW);
  has(html, "작업 폴더의 파일");
  has(html, '<span>index.html</span><small><span aria-hidden="true" data-provenance-symbol="true">✎</span> <strong>내가 고침</strong> · 지금까지: AI가 만듦 → 내가 고침</small>');
  has(html, '<span>images/외관.jpg</span><small><span aria-hidden="true" data-provenance-symbol="true">⇡</span> <strong>내가 올림</strong></small>');
  has(html, '<span>notes.md</span><small><span aria-hidden="true" data-provenance-symbol="true">○</span> <strong>기록 없음</strong></small>');
  has(html, "기록에 남은 일로만 표시해요.");
});
t("a Studio write reads as Studio's, with its own symbol", () => {
  const studio = provenanceView(recordHostWrite(ledger, [{ path: "engine.js", sha256: h("e") }], { at: 5, actor: "studio" }));
  has(list(studio), '<span>engine.js</span><small><span aria-hidden="true" data-provenance-symbol="true">▣</span> <strong>Studio가 만듦</strong></small>');
});
t("newest recorded event first, 기록 없음 last", () => {
  const html = list(VIEW);
  const order = ["index.html", "images/외관.jpg", "notes.md"].map((p) => html.indexOf(`<span>${p}</span>`));
  if (!(order[0] < order[1] && order[1] < order[2])) throw new Error(`order ${order}`);
});
t("rows keep a 44px target and no colour-only cue", () => {
  const html = list(VIEW);
  has(html, "min-height:44px");
  lacks(html, "color:");
});
t("a single step has no history line", () => {
  const html = list(VIEW);
  const photo = html.slice(html.indexOf("<span>images/외관.jpg</span>"), html.indexOf("<span>notes.md</span>"));
  lacks(photo, "지금까지");
});
t("states with nothing to list say why", () => {
  has(list(undefined), "파일 기록을 불러오는 중…");
  has(list(null), "작업 폴더가 열려 있지 않아서 보여 줄 파일이 없어요.");
  has(list({ entries: [], more: 0, unobserved: true, unconfirmed: false }), "아직 기록이 없어요. 이 목록을 열거나 AI에게 요청을 보내면 그때부터 기록해요.");
  has(list({ entries: [], more: 0, unobserved: false, unconfirmed: false }), "작업 폴더에 아직 파일이 없어요.");
  has(list({ ...VIEW, more: 12 }), "파일 12개는 더 있어서 여기에 다 보여 주지 못했어요.");
});
t("an unconfirmed folder says why every file reads 기록 없음", () => {
  const html = list(provenanceView({ ...ledger, stale: true }));
  has(html, "지금 작업 폴더를 다 확인하지 못해서 모든 파일을 ‘기록 없음’으로 보여 줘요.");
  lacks(html, "<strong>내가 고침</strong>");
  lacks(html, "<strong>AI가 만듦</strong>");
  lacks(list(VIEW), "artifact-provenance-unconfirmed");
});
t("negative control: no score, percentage or capability name near the labels", () => {
  const html = list(VIEW);
  for (const bad of ["%", "점수", "FRAMING", "JUDGMENT", "OWNERSHIP", "VERIFY", "ADAPT", "ORCHESTRATE"]) lacks(html, bad);
});
t("negative control: the closed 작업 자료 panel draws no file list", () => {
  const html = renderToStaticMarkup(<TaskWorkspace view={{ scope: "s", revision: 1, activeTaskId: "a", tasks: [{ id: "a", title: "첫 작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null }} messages={[]} busy={false} error={null} onDismissError={() => {}}><div /></TaskWorkspace>);
  has(html, "작업 자료");
  lacks(html, "작업 폴더의 파일");
});

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("all passed");
