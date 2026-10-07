// "주간 리뷰" panel (cr-review, #1398; CR-48–CR-53, CR-62).
//
// Draws the pack the host read from the Service (`ReviewView`): the student's "주간 리뷰 준비하기"
// and the director's overview, pack and decision form. It decides nothing: which sections are
// stale, what a claim rests on and whether that source still exists are the Service's. The AI's
// suggestion is its own section and says so; a stale section is marked; every claim opens the
// records it names; a director's decision is written only from the pack revision on screen.
import { useEffect, useState } from "react";
import type { DirectorDecisionForm, NextExperimentForm, ReviewAnswer, ReviewItemView, ReviewSectionView, ReviewSourceView, ReviewView } from "../../src/reviewView";
import { MARK_LABEL, METHOD_CHOICES, STATUS_LABEL, directorFormProblems, packChoices, sectionTitle, suggestedNext, timingLine } from "../../src/reviewView";

const time = (t: number | null) => (t ? new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function Claim(props: { item: ReviewItemView; sources: Record<string, ReviewSourceView> }) {
  const { item } = props;
  const [open, setOpen] = useState(false);
  return (
    <li data-testid="review-item" data-class={item.class}>
      <span>{item.text}</span>
      {(item.marks ?? []).map((m) => (
        <em key={m} data-testid="review-mark" data-mark={m}> · {MARK_LABEL[m] ?? m}</em>
      ))}
      {item.sources.length > 0 && (
        <button type="button" className="hps-evidence-claim" aria-expanded={open} data-testid="review-sources-toggle" onClick={() => setOpen(!open)}>
          근거 {item.sources.length}개
        </button>
      )}
      {open && (
        <ul className="hps-evidence-sources" data-testid="review-sources">
          {item.sources.map((ref) => {
            const s = props.sources[ref];
            return (
              <li key={ref} data-ref={ref} data-found={s?.found ? "yes" : "no"}>
                {s?.found ? s.label : "찾을 수 없는 기록이에요 (지워졌거나 바뀌었어요)"}
                {s?.found && s.lines.length > 0 && (
                  <ul>
                    {s.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function Section(props: { section: ReviewSectionView; week: number; stale: boolean; sources: Record<string, ReviewSourceView> }) {
  const { section } = props;
  const title = sectionTitle(section.id, props.week);
  return (
    <section data-testid="review-section" data-section={section.id} data-stale={props.stale ? "yes" : "no"} aria-label={title}>
      <h5>
        {title}
        {props.stale && <em data-testid="review-section-stale"> · 준비한 뒤로 바뀌었어요</em>}
      </h5>
      {section.notes.map((n, i) => (
        <p key={i} data-testid="review-note">{n}</p>
      ))}
      {section.items.length > 0 && (
        <ul>
          {section.items.map((it, i) => (
            <Claim key={i} item={it} sources={props.sources} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The pack itself: its status, its ten sections, and the director's decisions written from it. */
function Pack(props: { review: ReviewAnswer }) {
  const { review } = props;
  const stale = new Set(review.stale_sections);
  return (
    <div data-testid="review-pack" data-week={review.week} data-revision={review.pack?.revision ?? 0}>
      <p data-testid="review-status" data-status={review.status}>
        {review.week}주차 · {STATUS_LABEL[review.status]}
        {review.pack && ` · ${time(review.pack.prepared_at)} 준비`}
      </p>
      {review.pack ? (
        review.pack.sections.map((s) => <Section key={s.id} section={s} week={review.week} stale={review.status === "stale" && stale.has(s.id)} sources={review.sources} />)
      ) : (
        <p data-testid="review-missing">이 팀은 {review.week}주차 리뷰를 아직 준비하지 않았어요.</p>
      )}
      {review.decisions.length > 0 && (
        <ul data-testid="review-decisions">
          {review.decisions.map((d) => {
            const draft = review.drafts.find((e) => e.id === d.next_experiment_id);
            return (
              <li key={d.id} data-testid="review-decision" data-actor={d.actor}>
                <strong>디렉터 결정: </strong>
                {d.statement}
                {d.no_evidence && " · 근거가 연결되지 않았어요"}
                {d.affected_deck_slides.length > 0 && ` · 슬라이드 ${d.affected_deck_slides.join(", ")}`}
                {draft && (
                  <div data-testid="review-draft">
                    다음 실험 초안 ({draft.week}주차): {draft.question}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const EMPTY_NEXT: NextExperimentForm = { hypothesis: "", question: "", method: "task_test", success_criteria: [] };

/**
 * CR-51, CR-52 — the director's decision and next experiment, written from the pack on screen.
 * `deciding` from the press until the host answers: the button is replaced by a status line, so
 * one press writes one decision.
 */
function DirectorForm(props: { review: ReviewAnswer; busy: boolean; deciding: boolean; onDecide(form: DirectorDecisionForm): void }) {
  const { review } = props;
  const choices = packChoices(review);
  const weekHypotheses = (review.pack?.sections.find((s) => s.id === "hypothesis")?.items ?? [])
    .flatMap((i) => i.sources.filter((r) => r.startsWith("hypothesis:")).map((r) => ({ id: r.slice("hypothesis:".length).split("@")[0]!, label: i.text })))
    .filter((h, i, all) => all.findIndex((x) => x.id === h.id) === i);
  const initial = (): DirectorDecisionForm => ({ statement: "", evidence_refs: [], assumption_refs: [], affected_deck_slides: [], next: { ...EMPTY_NEXT, ...suggestedNext(review) } });
  const [form, setForm] = useState<DirectorDecisionForm>(initial);
  const [withNext, setWithNext] = useState(true);
  // A new pack (another team, week or revision) starts a new form from its suggestion.
  useEffect(() => {
    setForm(initial());
    setWithNext(true);
  }, [review.project_id, review.week, review.pack?.revision]);
  const next = form.next ?? EMPTY_NEXT;
  const setNext = (patch: Partial<NextExperimentForm>) => setForm((f) => ({ ...f, next: { ...(f.next ?? EMPTY_NEXT), ...patch } }));
  const toggle = (key: "evidence_refs" | "assumption_refs", ref: string, on: boolean) => setForm((f) => ({ ...f, [key]: on ? [...f[key], ref] : f[key].filter((x) => x !== ref) }));
  const sent: DirectorDecisionForm = { ...form, next: withNext ? next : null };
  const problems = directorFormProblems(sent);
  return (
    <details data-testid="review-decision-form" open>
      <summary>디렉터 결정 기록하기</summary>
      <textarea aria-label="결정" rows={2} value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} placeholder="팀과 함께 무엇을 하기로 했나요?" />
      <div>이 결정의 근거 (이 리뷰에서 고르기)</div>
      <ul>
        {choices.evidence.map((c) => (
          <li key={c.ref}>
            <label>
              <input type="checkbox" data-testid="review-pick-evidence" data-ref={c.ref} checked={form.evidence_refs.includes(c.ref)} onChange={(e) => toggle("evidence_refs", c.ref, e.target.checked)} />
              {c.label}
            </label>
          </li>
        ))}
      </ul>
      {choices.assumptions.length > 0 && (
        <>
          <div>이 결정이 기대는 가정</div>
          <ul>
            {choices.assumptions.map((c) => (
              <li key={c.ref}>
                <label>
                  <input type="checkbox" data-testid="review-pick-assumption" data-ref={c.ref} checked={form.assumption_refs.includes(c.ref)} onChange={(e) => toggle("assumption_refs", c.ref, e.target.checked)} />
                  {c.label}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div>
        바뀌는 발표 슬라이드{" "}
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <label key={n}>
            <input type="checkbox" data-testid="review-pick-slide" data-slide={n} checked={form.affected_deck_slides.includes(n)} onChange={(e) => setForm({ ...form, affected_deck_slides: e.target.checked ? [...form.affected_deck_slides, n].sort((a, b) => a - b) : form.affected_deck_slides.filter((x) => x !== n) })} />
            {n}
          </label>
        ))}
      </div>
      <label>
        <input type="checkbox" data-testid="review-with-next" checked={withNext} onChange={(e) => setWithNext(e.target.checked)} />
        다음 실험도 함께 기록하기 (초안)
      </label>
      {withNext && (
        <div data-testid="review-next-form">
          <select aria-label="다음 실험이 확인할 가설" value={next.hypothesis_id ?? ""} onChange={(e) => setNext(e.target.value ? { hypothesis_id: e.target.value } : { hypothesis_id: undefined })}>
            <option value="">새 가설 쓰기</option>
            {weekHypotheses.map((h) => (
              <option key={h.id} value={h.id}>{h.label}</option>
            ))}
          </select>
          {!next.hypothesis_id && <textarea aria-label="새 가설" rows={2} value={next.hypothesis ?? ""} onChange={(e) => setNext({ hypothesis: e.target.value })} placeholder="다음 실험으로 확인할 가설" />}
          <input aria-label="다음 실험 질문" value={next.question} onChange={(e) => setNext({ question: e.target.value })} placeholder="무엇을 알아보나요?" />
          <select aria-label="다음 실험 방법" value={next.method} onChange={(e) => setNext({ method: e.target.value })}>
            {METHOD_CHOICES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <textarea aria-label="다음 실험 성공 기준" rows={3} value={next.success_criteria.join("\n")} onChange={(e) => setNext({ success_criteria: e.target.value.split("\n") })} placeholder="한 줄에 하나씩, 셀 수 있게" />
        </div>
      )}
      {problems.length > 0 && form.statement.trim() && <p data-testid="review-form-problems">{problems.join(" ")}</p>}
      {/* While a decision is in flight there is no button to press again: one press, one decision. */}
      {props.deciding ? (
        <p data-testid="review-deciding" role="status">
          결정을 기록하고 있어요…
        </p>
      ) : (
        <button type="button" data-testid="review-decide" disabled={props.busy || problems.length > 0} onClick={() => props.onDecide(sent)}>
          결정 기록하기
        </button>
      )}
    </details>
  );
}

export function ReviewPanel(props: {
  view: ReviewView;
  error: string | null;
  done: string | null;
  busy: boolean;
  /** A director decision was sent and the host has not answered yet. */
  deciding?: boolean;
  onRefresh(): void;
  onPrepare(): void;
  onOpenTeam(projectId: string | null): void;
  onDecide(projectId: string, week: number, revision: number, form: DirectorDecisionForm): void;
  onClose(): void;
}) {
  const { view } = props;
  const director = view.mode === "director";
  const review = view.review;
  return (
    <section className="hps-evidence" data-testid="review-panel" data-mode={view.mode} aria-label={director ? "주간 리뷰 (디렉터)" : "주간 리뷰"}>
      <header>
        <strong>{director ? "주간 리뷰 · 디렉터" : "주간 리뷰"}</strong>
        <button type="button" onClick={props.onRefresh} disabled={props.busy || view.running || props.deciding === true}>새로 불러오기</button>
        <button type="button" onClick={props.onClose} aria-label="닫기">✕</button>
      </header>
      {view.notice && <p data-testid="review-notice">{view.notice}</p>}
      {props.error && <div className="hps-publish-error" role="alert" data-testid="review-error">{props.error}</div>}
      {props.done && <div className="hps-evidence-done" role="status" data-testid="review-done">{props.done}</div>}
      {!director && view.available && (
        <div>
          <p>수업 전에 준비해 두면 디렉터가 기다리지 않고 바로 열어 볼 수 있어요. 바뀐 부분만 다시 만들어요.</p>
          <button type="button" data-testid="review-prepare" disabled={props.busy || view.running} onClick={props.onPrepare}>
            {view.running ? "준비하는 중…" : "주간 리뷰 준비하기"}
          </button>
          {view.timing && <p data-testid="review-timing" data-verdict={view.timing.verdict}>{timingLine(view.timing)}</p>}
          {view.refused && (
            <p data-testid="review-refused" data-code={view.refused.join(" ")}>
              AI가 만든 다음 실험 제안은 저장하지 않았어요. 나머지는 저장했어요.
            </p>
          )}
        </div>
      )}
      {director && view.teams && !review && (
        <ul data-testid="review-teams">
          {view.teams.map((t) => (
            <li key={t.project_id} data-testid="review-team" data-status={t.status} data-project={t.project_id}>
              <button type="button" onClick={() => props.onOpenTeam(t.project_id)}>
                {t.title} · {t.week}주차 · {STATUS_LABEL[t.status]}
              </button>
            </li>
          ))}
          {view.teams.length === 0 && <li>아직 이 수업에 팀 프로젝트가 없어요.</li>}
          {view.truncated && <li>팀이 많아 일부만 보여 줘요.</li>}
        </ul>
      )}
      {director && review && (
        <button type="button" data-testid="review-back" onClick={() => props.onOpenTeam(null)}>
          모든 팀 보기
        </button>
      )}
      {review && (
        <>
          <h4>{review.project_title}</h4>
          <Pack review={review} />
          {director && review.pack && <DirectorForm review={review} busy={props.busy} deciding={props.deciding === true} onDecide={(form) => props.onDecide(review.project_id, review.week, review.pack!.revision, form)} />}
        </>
      )}
    </section>
  );
}
