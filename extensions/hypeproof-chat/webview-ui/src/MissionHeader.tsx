// Region A — Mission header (SX-01 ~ SX-05).
//
// Requirements: docs/requirements/studio-learning-experience.md A. HOME
// Design: docs/design/studio-learning-experience.md §정보 구조 (region A)
//
// This screen does one thing: **keep you from losing track of what to do right now.**
// So top to bottom it is week → one mission sentence → the 1–3 actions to do now →
// completion conditions → "지난번 이어서" when an earlier session left the task mid-way
// (SX-02) → the learner's own goal when they wrote one (AE-01) → steps remaining, and the
// growth-record entry sits **below that, at link size** (SX-03).
// The largest type is the mission sentence — the 5-second recall test (SX-T01) looks at it.
//
// What is not here, and why:
//   · scores, grades, percentages, badges — SX-59. `test/sx-audit.smoke.mjs` audits the render result.
//   · a progress card — SX-51. "남은 단계 3" is a **sentence**, not a number card.
//   · interpretive sentences — interpretation happens only in the retrospective and the growth record (SX-17).
//
// Which step the student is LOOKING AT is a view state the webview keeps. The truth about
// the task is the host's (§정보 구조 "호스트·웹뷰·워커의 경계"): it judges the SX-14 gate
// from the learning events and sends the result down as `learningState`, and this header
// checks a completion condition off (☑) only where that verdict says it is met (`missing`,
// SX-55). Where the host sends no verdict — a seat that records no learning events — every
// condition stays unchecked (☐) and the header says so: drawing a check mark with no
// evidence is the one thing this product must most avoid.

import { useEffect, useRef } from "react";
import type { ResolvedProfile } from "../../src/protocol";
import { actionsFrom, completionMet, resumeStepOf, stepsRemaining, type LessonStep as Step } from "./missionHeaderLogic";

type Lesson = NonNullable<ResolvedProfile["lesson"]>;

export interface MissionHeaderProps {
  lesson: Lesson | null;
  /**
   * The host's SX-14 gate verdict for this task (`learningState.complete.missing`): what is
   * still missing. null when the host sends no verdict; then nothing is checked off.
   */
  missing?: ReadonlyArray<{ item?: string; event?: string }> | null;
  /**
   * The id of the step currently being viewed. null means the first step. ChatPanel starts it at
   * the step the task's record holds (`stepViewOnState`), not at the first step.
   */
  currentStepId: string | null;
  onSelectStep: (stepId: string) => void;
  /** Feeds the current step's task to the coach. The screen's only Primary CTA (SX-04). */
  onStartStep: (step: Step) => void;
  /** To the growth record. A single small link (SX-03). */
  onOpenGrowth: () => void;
  /**
   * While streaming the Primary goes busy and no second Primary appears (SX-04). ChatPanel also
   * holds it busy on a task-flow seat until the host's learning state has shown the task's record
   * (`recordShownBy`): before that the header stands on the first step, not the recorded one.
   */
  busy: boolean;
  /** Activity kind and name. Demoted to a small line inside the header (design §정보 구조, region A). */
  activity: { label: string; name: string; verified: boolean } | null;
  /**
   * SX-02 — "지난번 이어서": the step the host says this task's record still holds from an earlier
   * session of the app (`learningState.resume`). null or absent: no entry. The host decides when
   * there is one; this header only draws it, and only for a step of this lesson.
   */
  resume?: { step: string } | null;
  /**
   * AE-01 (#554) — the learner's own goal for this lesson, as the host stored it (`goalOfLesson`). It
   * is the student's sentence, drawn quietly under the lesson's own conditions (at most two lines,
   * read whole in the rail) so it stays with the header while the conversation scrolls or a result
   * opens beside it. On a short window the header packs and the goal comes after the conditions,
   * inside the header's own scroll (styles.css). Empty or absent: no line (nothing is invented).
   * Editing lives in the rail (StudentGoal.tsx).
   */
  goal?: string | null;
}

export function MissionHeader(props: MissionHeaderProps) {
  const { lesson, currentStepId, activity } = props;
  const content = lesson?.content ?? null;
  const learning = content?.learning ?? null;
  const steps = content?.steps ?? [];
  const actions = actionsFrom(steps, currentStepId);
  const remaining = stepsRemaining(steps, currentStepId);
  const current = actions[0] ?? null;
  const resumeStep = resumeStepOf(steps, props.resume);

  // "지난번 이어서" hands the keyboard to the recorded step's action (the Primary). The view already
  // starts at the recorded step (ChatPanel, `stepViewOnState`), so usually the entry only moves the
  // focus, at once. If the student has since looked at another step, it first brings the recorded
  // one back to the front, and the focus waits for the render that moved it. Either way the entry
  // never does nothing.
  const primary = useRef<HTMLButtonElement | null>(null);
  const focusAfterMove = useRef(false);
  useEffect(() => {
    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    primary.current?.focus();
  });
  const resumeAt = (step: Step) => {
    if (current?.id === step.id) {
      primary.current?.focus();
      return;
    }
    focusAfterMove.current = true;
    props.onSelectStep(step.id);
  };

  return (
    <header className="hp-mission" aria-label="현재 과제">
      {learning ? (
        <p className="hp-mission-week">{learning.week}주차</p>
      ) : null}

      {/* The largest type — and only when there is a design file to read it from.
          Two DIFFERENT rows govern two different states, and an earlier version of
          this line collapsed them into one sentence:

            SX-01 부정  design file present, mission empty
                        -> "미션이 정해지지 않았습니다" (not an empty header)
            SX-02 부정  no design file at all
                        -> "'지난번 이어서'만 보이고 진행률 카드로 대체하지 않는다"

          The second case used to render "아직 연결된 수업이 없습니다." in the largest
          type on the work screen. No row asks for that sentence, and it is what every
          one of the 9 cohorts would have shown the day this header shipped, because
          none of them has a session design published. Substituting a sentence for a
          mission is the same move SX-02 forbids when it says not to substitute a
          progress card.

          The 이어가기 진입 SX-02 asks for is drawn further down ("지난번 이어서"), from
          the task record the task flow keeps — which only a seat with a mission has.
          With no design file there is no record and no entry: what "이어가기" would
          resume on such a seat (the conversation, which already reopens by itself, or
          the project folder) is still an open question, so this seat shows the activity
          line below and nothing invented above it. */}
      {content ? (
        <h1 className="hp-mission-sentence">
          {learning?.mission ?? "미션이 정해지지 않았습니다."}
        </h1>
      ) : null}

      {activity ? (
        // `aria-label="현재 활동"` is what the old `hps-activity-header` carried.
        // Moving this line into the mission header as a small line dropped the label, and
        // CI's real-browser check (US-UI-DRAFT) broke at `getByLabel('현재 활동')`. The
        // contract — a screen reader must be able to point out that the activity changed —
        // is unchanged by the move.
        <p className="hp-mission-activity" aria-label="현재 활동">
          {activity.label} · {activity.name}
          {!activity.verified ? (
            <span role="status"> · 연결을 확인하지 못했습니다. 저장된 기록을 볼 수 있으며, 다시 연결한 뒤 보낼 수 있습니다.</span>
          ) : null}
        </p>
      ) : null}

      {actions.length ? (
        <ol className="hp-mission-actions" aria-label="지금 할 것">
          {actions.map((step, index) => (
            <li key={step.id} className={index === 0 ? "hp-mission-action hp-mission-action-now" : "hp-mission-action"}>
              {index === 0 ? (
                <button
                  ref={primary}
                  type="button"
                  className="hp-cta-primary"
                  disabled={props.busy}
                  onClick={() => props.onStartStep(step)}
                >
                  {step.title}
                </button>
              ) : (
                <button type="button" className="hp-cta-quiet" data-step-id={step.id} onClick={() => props.onSelectStep(step.id)}>
                  {step.title}
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {current ? <p className="hp-mission-acceptance">이번 단계가 끝났다고 볼 조건: {current.acceptance}</p> : null}

      {learning?.completion?.length ? (
        <ul className="hp-mission-completion" aria-label="이번 주차의 완료 조건">
          {learning.completion.map((item) => {
            const met = props.missing ? completionMet(item, props.missing) : false;
            return (
              <li key={item.id} data-met={met ? "yes" : "no"}>
                {/* SX-50 — state is never expressed by color alone: an icon AND words. The mark
                    carries its state for a screen reader too, now that marks differ. The rehearsal
                    read-back (LessonStepPanel `drawnMission`) reads only the `-text` span, so the
                    condition's wording stays exactly what the design file says. */}
                <span className="hp-mark" role="img" aria-label={met ? "확인됨" : "아직"}>{met ? "☑" : "☐"}</span>
                <span className="hp-mission-completion-text">{item.text}</span>
              </li>
            );
          })}
          <li className="hp-mission-completion-note">
            <span className="hp-mark" aria-hidden="true">·</span>
            <span>
              {props.missing
                ? "☑ 표시는 내가 남긴 기록에서 확인된 것이에요."
                : "확인 표시는 직접 적고 시험한 기록이 쌓일 때 붙습니다. 지금은 아직 확인 전입니다."}
            </span>
          </li>
        </ul>
      ) : null}

      {/* SX-02 — "지난번 이어서": below the actions and the completion conditions, above the
          growth-record link (PROJECT_RULES order). A quiet button, never a Primary (SX-04): the
          one emphasized action stays the step to do now. No date, count or progress figure
          (SX-51) — the step's own title is the whole entry. */}
      {resumeStep ? (
        <p className="hp-mission-resume">
          <button type="button" className="hp-cta-quiet" data-resume-step={resumeStep.id} onClick={() => resumeAt(resumeStep)}>
            지난번 이어서 · {resumeStep.title}
          </button>
        </p>
      ) : null}

      {/* AE-01 — the learner's own goal, apart from the lesson's conditions above it: its own label, its own
          class (the rehearsal read-back reads `hp-mission-completion-text` only), no mark, no button. */}
      {props.goal ? (
        <p className="hp-mission-goal">
          <span className="hp-mission-goal-label">내 목표</span>
          {" · "}
          <span className="hp-mission-goal-text">{props.goal}</span>
        </p>
      ) : null}

      <p className="hp-mission-foot">
        {steps.length ? <span className="hp-mission-remaining">남은 단계 {remaining}</span> : null}
        <button type="button" className="hp-mission-growth" onClick={props.onOpenGrowth}>
          나의 변화 기록 ›
        </button>
      </p>
    </header>
  );
}
