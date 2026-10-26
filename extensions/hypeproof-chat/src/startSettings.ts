/**
 * CGP-SHELL-R-014 (REQ-SHELL-14): the start page "설정" opens a small learner settings sheet,
 * never the VS Code settings editor. The editor is reachable only from the sheet's "고급 설정",
 * which minor cohorts do not see.
 *
 * Pure (no vscode, no DOM): the host builds the view and validates every write here; the webview
 * only draws the view and posts the learner's choice.
 *
 * Only rows whose behaviour exists today are listed (DEC-SHELL-R014 in decisions.md):
 * 글자 크기 (CGP-DS-R-009 text size), 움직임 줄이기 (workbench.reduceMotion, CGP-DS-R-015) and
 * 알림 (hypeproofChat.osTaskNotices, the task-notice core patch). 화면 밝기(테마) (REQ-SHELL-16),
 * 팁 보기 (REQ-SHELL-19) and 내 작업 내보내기 (REQ-SHELL-28) join the list when their rows ship;
 * a row without its behaviour would be a switch that does nothing.
 */
import { normalizeTextSize, type TextSize } from "./textSize";

/** The six rows REQ-SHELL-14 names, in its order. The sheet never lists more than these. */
export const START_SETTING_ROWS = ["textSize", "theme", "reduceMotion", "notices", "tips", "export"] as const;
export type StartSettingRow = (typeof START_SETTING_ROWS)[number];
export const START_SETTINGS_MAX_ROWS = 6;
/** Rows whose behaviour exists in this build. */
export const START_SETTING_ROWS_AVAILABLE: readonly StartSettingRow[] = ["textSize", "reduceMotion", "notices"];

export const REDUCE_MOTION_CHOICES = ["auto", "on", "off"] as const;
export type ReduceMotionChoice = (typeof REDUCE_MOTION_CHOICES)[number];

export const START_SETTINGS_COPY = {
  title: "설정",
  close: "설정 닫기",
  textSize: "글자 크기",
  textSizeHint: "혼자 하는 활동의 대화 글자 크기예요.",
  reduceMotion: "움직임 줄이기",
  reduceMotionLabels: { auto: "기기 설정 따르기", on: "줄이기", off: "줄이지 않기" } as Record<ReduceMotionChoice, string>,
  notices: "알림",
  noticesLabel: "창을 보고 있지 않을 때 컴퓨터 알림으로도 알려 주기",
  noticesHint: "코치가 일을 마치거나 확인을 기다릴 때 알려요. 답변 내용은 알림에 넣지 않아요.",
  advanced: "고급 설정",
} as const;

export interface StartSettingsView {
  rows: StartSettingRow[];
  textSize: TextSize;
  reduceMotion: ReduceMotionChoice;
  notices: boolean;
  /** "고급 설정" is drawn (and honoured by the host) only when this is true. */
  advanced: boolean;
}

export function normalizeReduceMotion(value: unknown): ReduceMotionChoice {
  return (REDUCE_MOTION_CHOICES as readonly unknown[]).includes(value) ? (value as ReduceMotionChoice) : "auto";
}

/**
 * Whether "고급 설정" is offered. Hidden for a minor cohort (REQ-SHELL-14): a connected or
 * previewed profile that `isMinor` calls minor (it fails closed on an unknown tier), or a free
 * start answered "under14". With no profile and no under-14 answer it stays, as the start page
 * "설정" reached the editor before this row (setup by an adult or staff).
 */
export function advancedSettingsAllowed(input: { profileMinor: boolean | null; age: unknown }): boolean {
  if (input.profileMinor === true) return false;
  if (input.age === "under14") return false;
  return true;
}

export function startSettingsView(input: {
  textSize: unknown;
  reduceMotion: unknown;
  notices: unknown;
  profileMinor: boolean | null;
  age: unknown;
}): StartSettingsView {
  return {
    rows: START_SETTING_ROWS.filter((row) => START_SETTING_ROWS_AVAILABLE.includes(row)).slice(0, START_SETTINGS_MAX_ROWS),
    textSize: normalizeTextSize(input.textSize),
    reduceMotion: normalizeReduceMotion(input.reduceMotion),
    notices: input.notices === true,
    advanced: advancedSettingsAllowed({ profileMinor: input.profileMinor, age: input.age }),
  };
}

export type StartSettingWrite =
  | { key: "textSize"; value: TextSize }
  | { key: "reduceMotion"; value: ReduceMotionChoice }
  | { key: "notices"; value: boolean };

/** A webview message is hostile input: only an exact known key with an exact known value is written. */
export function parseStartSettingWrite(msg: unknown): StartSettingWrite | null {
  if (!msg || typeof msg !== "object") return null;
  const { key, value } = msg as { key?: unknown; value?: unknown };
  if (key === "textSize" && typeof value === "string" && normalizeTextSize(value) === value) return { key, value: value as TextSize };
  if (key === "reduceMotion" && typeof value === "string" && normalizeReduceMotion(value) === value) return { key, value: value as ReduceMotionChoice };
  if (key === "notices" && typeof value === "boolean") return { key, value };
  return null;
}
