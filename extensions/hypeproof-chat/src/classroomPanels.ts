// Which classroom-operation panels the learner's chat rail draws (#751): "강사에게 도움 요청" (a
// question to the instructor who paired the seat in Chalk) and "수업 결과물 승인" (marking
// index.html as the result an instructor collects).
//
// The Service decides per cohort (`classroom_panels` on /v1/profile, hype-dental D-025,
// 2026-10-14): a class that runs no Chalk classroom operations turns them off so learners do not
// meet panels nobody answers. Absent → shown, the behaviour before the switch existed; only an
// explicit `false` hides a panel. Pure, no `vscode`: the webview imports it.

export interface ClassroomPanelsSetting {
  help_request?: boolean;
  artifact_approval?: boolean;
}

export function classroomPanelsShown(profile: { classroom_panels?: ClassroomPanelsSetting } | null | undefined): { help: boolean; approval: boolean } {
  const p = profile?.classroom_panels;
  return { help: p?.help_request !== false, approval: p?.artifact_approval !== false };
}
