// AE-01 (#554) — "내 목표": the student's own goal and completion criteria for the current lesson.
//
// Where it sits: the coach rail, right under region A and before the step guidance, where the step's help choice
// already lives (design §정보 구조: learning information goes in the header and the rail, SX-05). Region A keeps the
// lesson's own criteria (the step's acceptance, the week's completion conditions) exactly as the design file says,
// and draws the saved goal under them, at most two lines (MissionHeader `goal`), fixed with the header: the AE design's
// "현재 과제 요약을 고정" (learning-agent-experience design, 정보의 우선순위). This block holds the rest: the personal
// criteria and the editor. It never draws, edits or sends the lesson's criteria, so writing a goal cannot remove one.
//
// What it keeps:
//   · closed by default: "완료 기준 편집" opens when needed (same design table). The editor's fields exist only while
//     the block is open, so the closed block adds no field to the screen: the composer stays the first text field,
//     and the lesson card stays the first `.hp-rail-lesson` (this block is `.hp-rail-goal`, same look);
//   · quiet controls only: the screen's one Primary stays region A's action (SX-04);
//   · no completion: nothing here marks a criterion as met or posts a step or task message. Opening it records
//     nothing, and saving changes only the goal (AE-01: "과제 열람만으로 완료되지 않는다");
//   · the values come from the host (`config.studentGoal` and `goalState`), so a reconnect or a second chat view
//     shows the same goal (AE-01: "대화와 결과를 오가도 유지한다"). The fields follow every goal the host sends, except
//     text the student typed and has not saved: another chat view's save keeps it, moves the next save's base to the
//     newer goal and says the goal was changed on another screen (`goalEditorOnView`). A save already sent from the
//     older revision is refused as stale by the host instead of replacing the newer save.
// Class names stay apart from region A's `hp-mission-*`: the rehearsal read-back (LessonStepPanel `drawnMission`) reads
// only those, so a student's criteria are never reported as the lesson's.

import { useEffect, useState } from "react";
import {
  GOAL_CHANGED_ELSEWHERE,
  GOAL_TEXT_MAX,
  goalEditOf,
  goalEditorOf,
  goalEditorOnEdit,
  goalEditorOnView,
  goalSavedNoteShown,
  type GoalEdit,
  type GoalEditorState,
  type GoalFields,
  type GoalNote,
  type GoalSaveRequest,
  type StudentGoalView,
} from "../../src/studentGoal";
import type { ResolvedProfile } from "../../src/protocol";

type Lesson = NonNullable<ResolvedProfile["lesson"]>;

export interface StudentGoalProps {
  lesson: Lesson;
  /** The host's goal for THIS lesson (`goalOfLesson`), or null before one arrives (drawn as not written yet). */
  view: StudentGoalView | null;
  /** The host's answer to THIS view's last save: refused (`error`) or stored (`saved`). Another view's save brings none. */
  note: GoalNote;
  /** This view sent a save that is not answered yet: a second one would only race it. */
  pending: boolean;
  onSave: (edit: GoalSaveRequest) => void;
}

export function StudentGoal({ lesson, view, note, pending, onSave }: StudentGoalProps) {
  const [editor, setEditor] = useState<GoalEditorState>(() => goalEditorOf(view));
  const [open, setOpen] = useState(false);
  // Every goal the host sends for this screen (this view's save, another chat view's, a reconnect, another lesson or
  // activity) moves the editor to it: untouched fields follow it, with its revision as the base of the next save, and
  // typed text stays (`goalEditorOnView`). `own`: the goal is this view's own save, so nothing is said about another screen.
  const own = !!note?.saved && note.revision === view?.revision;
  useEffect(() => {
    setEditor((state) => goalEditorOnView(state, view, own));
  }, [lesson.sha256, view?.lesson.sha256, view?.activity, view?.revision]);

  const fields = editor.fields;
  const edit = goalEditOf(view, lesson.sha256, fields, pending);
  const goal = view?.goal ?? "";
  const criteria = view?.criteria ?? [];

  return (
    <details className="hp-rail-goal hp-goal" data-student-goal={view?.revision ?? 0} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
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

      {open ? <GoalEditor fields={fields} edit={edit} onEdit={(patch) => setEditor((state) => goalEditorOnEdit(state, patch))} onSave={onSave} /> : null}

      {note?.error ? (
        <p className="hp-goal-error" role="alert">{note.error}</p>
      ) : goalSavedNoteShown(note, view, edit) ? (
        <p className="hp-rail-lesson-note" role="status">저장했어요.</p>
      ) : editor.elsewhere && !edit.unchanged ? (
        <p className="hp-rail-lesson-note hp-goal-elsewhere" role="status">{GOAL_CHANGED_ELSEWHERE}</p>
      ) : null}
      <p className="hp-rail-lesson-note">
        수업이 정한 조건은 내 목표를 고쳐도 그대로예요. 목표를 적거나 고쳐도 과제가 완료되지는 않아요.
      </p>
    </details>
  );
}

export interface GoalEditorProps {
  fields: GoalFields;
  /** `goalEditOf` over these fields: what a save would send, or why it cannot. */
  edit: GoalEdit;
  onEdit: (patch: Partial<Pick<GoalFields, "goal" | "criteria">>) => void;
  onSave: (edit: GoalSaveRequest) => void;
}

/** The editor: drawn only while the block is open. The button saves exactly the request `goalEditOf` built, or nothing. */
export function GoalEditor({ fields, edit, onEdit, onSave }: GoalEditorProps) {
  return (
    <form
      className="hp-surface hp-goal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (edit.save) onSave(edit.save);
      }}
    >
      <label>
        내 목표 — 무엇을 만들고, 어떻게 되면 좋을지 적어요
        <textarea name="goal" value={fields.goal} maxLength={GOAL_TEXT_MAX} rows={2} onChange={(e) => onEdit({ goal: e.target.value })} />
      </label>
      <label>
        내 완료 기준 — 한 줄에 하나씩, 다섯 줄까지 적어요
        <textarea name="criteria" value={fields.criteria} rows={3} onChange={(e) => onEdit({ criteria: e.target.value })} />
      </label>
      {edit.tooLong ? (
        <p className="hp-rail-lesson-note" role="status">한 줄이 너무 길어요. 조금 줄여 주세요.</p>
      ) : null}
      {edit.tooMany ? (
        <p className="hp-rail-lesson-note" role="status">다섯 줄까지만 저장할 수 있어요.</p>
      ) : null}
      <button type="submit" className="hp-cta-quiet" disabled={!edit.save}>
        목표 저장
      </button>
    </form>
  );
}
