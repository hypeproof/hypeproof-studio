// AE-01 (#554) — "내 목표": the student's own goal and completion criteria for the current lesson.
//
// Where it sits: the coach rail, right under region A and before the step guidance, where the step's help choice
// already lives (design §정보 구조: learning information goes in the header and the rail, SX-05). Region A keeps the
// lesson's own criteria (the step's acceptance, the week's completion conditions) exactly as the design file says,
// and draws the saved goal as one line under them (MissionHeader `goal`), fixed with the header: the AE design's
// "현재 과제 요약을 고정" (learning-agent-experience design, 정보의 우선순위). This block holds the rest: the personal
// criteria and the editor. It never draws, edits or sends the lesson's criteria, so writing a goal cannot remove one.
//
// What it keeps:
//   · closed by default: "완료 기준 편집" opens when needed (same design table);
//   · quiet controls only: the screen's one Primary stays region A's action (SX-04);
//   · no completion: nothing here marks a criterion as met or posts a step or task message. Opening it records
//     nothing, and saving changes only the goal (AE-01: "과제 열람만으로 완료되지 않는다");
//   · the values come from the host (`config.studentGoal`, then `goalState`), so a reconnect or a second chat view
//     shows the same goal (AE-01: "대화와 결과를 오가도 유지한다").
// Class names stay apart from region A's `hp-mission-*`: the rehearsal read-back (LessonStepPanel `drawnMission`) reads
// only those, so a student's criteria are never reported as the lesson's.

import { useEffect, useState } from "react";
import {
  GOAL_CRITERIA_MAX,
  GOAL_CRITERION_MAX,
  GOAL_TEXT_MAX,
  goalCriteriaFromText,
  type GoalSaveRequest,
  type StudentGoalView,
} from "../../src/studentGoal";
import type { ResolvedProfile } from "../../src/protocol";

type Lesson = NonNullable<ResolvedProfile["lesson"]>;

export interface StudentGoalProps {
  lesson: Lesson;
  /** The host's goal for THIS lesson (`goalOfLesson`), or null before one arrives (drawn as not written yet). */
  view: StudentGoalView | null;
  /** The host's answer to the last save: refused (`error`) or stored (`saved`). */
  note: { error?: string; saved?: boolean } | null;
  onSave: (edit: GoalSaveRequest) => void;
}

export function StudentGoal({ lesson, view, note, onSave }: StudentGoalProps) {
  const goal = view?.goal ?? "";
  const criteria = view?.criteria ?? [];
  const revision = view?.revision ?? 0;
  const [goalText, setGoalText] = useState(goal);
  const [criteriaText, setCriteriaText] = useState(criteria.join("\n"));
  // A new revision from the host (this view's save, another chat view's, a reconnect) replaces what the fields hold.
  useEffect(() => {
    setGoalText(goal);
    setCriteriaText(criteria.join("\n"));
  }, [lesson.sha256, revision]);

  const edited = goalCriteriaFromText(criteriaText);
  const unchanged = goalText.trim() === goal && edited.join("\n") === criteria.join("\n");
  const tooMany = edited.length > GOAL_CRITERIA_MAX;
  const tooLong = edited.some((c) => c.length > GOAL_CRITERION_MAX);
  const blocked = unchanged || tooMany || tooLong;

  return (
    <details className="hp-rail-lesson hp-goal" data-student-goal={revision}>
      <summary>{goal || criteria.length ? "내 목표와 완료 기준 보기·고치기" : "내 목표와 완료 기준 적기"}</summary>
      <p className="hp-goal-current">
        <span className="hp-goal-label">내 목표</span>
        {" · "}
        <span className="hp-goal-text">{goal || "아직 적지 않았어요"}</span>
      </p>

      <section className="hp-goal-criteria" aria-label="내가 정한 완료 기준">
        <p className="hp-goal-heading">내가 정한 완료 기준</p>
        {criteria.length ? (
          <ul>
            {criteria.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="hp-rail-lesson-note">아직 내가 정한 완료 기준이 없어요.</p>
        )}
      </section>

      <form
        className="hp-surface hp-goal-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          onSave({ lesson: lesson.sha256, goal: goalText, criteria: edited, base: revision });
        }}
      >
        <label>
          내 목표 — 무엇을 만들고, 어떻게 되면 좋을지 적어요
          <textarea value={goalText} maxLength={GOAL_TEXT_MAX} rows={2} onChange={(e) => setGoalText(e.target.value)} />
        </label>
        <label>
          내 완료 기준 — 한 줄에 하나씩, 다섯 줄까지 적어요
          <textarea value={criteriaText} rows={3} onChange={(e) => setCriteriaText(e.target.value)} />
        </label>
        {tooLong ? (
          <p className="hp-rail-lesson-note" role="status">한 줄이 너무 길어요. 조금 줄여 주세요.</p>
        ) : null}
        {tooMany ? (
          <p className="hp-rail-lesson-note" role="status">다섯 줄까지만 저장할 수 있어요.</p>
        ) : null}
        <button type="submit" className="hp-cta-quiet" disabled={blocked}>
          목표 저장
        </button>
      </form>

      {note?.error ? (
        <p className="hp-goal-error" role="alert">{note.error}</p>
      ) : note?.saved ? (
        <p className="hp-rail-lesson-note" role="status">저장했어요.</p>
      ) : null}
      <p className="hp-rail-lesson-note">
        수업이 정한 조건은 내 목표를 고쳐도 그대로예요. 목표를 적거나 고쳐도 과제가 완료되지는 않아요.
      </p>
    </details>
  );
}
