// CGP-KNOW-R-029 (REQ-KNOW-47 / DES-KNOW-47) — "기록 없이 묻기": a task on an adult personal seat that this computer keeps
// in memory only. Dependency-free, so the host and the webview share the words.
//
// What the client guarantees, and what it does not: the task is never written to the task file, a draft, the session
// spool, the memory-use ledger or the Agent SDK's session files (`persistSession: false`), and it can change no file
// (chat only: read tools at most). The request itself still goes to the Service to be answered, and the Service's own
// logging is the Service's (a per-request no-log flag is a Service contract, blocked-external). So the copy promises
// "this device", never "nowhere".

import type { ResolvedProfile } from "./protocol";

/** The one reason every seat that may not open it sees: class, lesson, minor and unknown seats alike (fail closed). */
export const TEMPORARY_TASK_UNAVAILABLE = "수업에서는 기록이 남아요";
/** No host write into the work folder comes from a temporary task: the answer's page is shown from memory. */
export const TEMPORARY_TASK_NO_WRITE = "기록 없이 묻는 작업에서는 작업 폴더의 파일을 만들거나 바꾸지 않아요. 결과는 미리보기에서만 보여요.";
/** A photo is saved into the work folder before it is sent, so a temporary task takes none. */
export const TEMPORARY_TASK_NO_IMAGES = "기록 없이 묻는 작업에서는 사진을 보낼 수 없어요. 사진은 입력창에 그대로 두었어요.";

export const TEMPORARY_TASK_COPY = {
  create: "기록 없이 묻기",
  // CGP-KNOW-D-029 (DES-KNOW-47) — the register's band title "기록이 남지 않는 작업", scoped to this device: the Service
  // still logs the request on some cohorts (contract #12), so an unscoped "not recorded" would promise too much.
  bandTitle: "이 기기에 기록이 남지 않는 작업",
  device: "이 기기에 기록을 남기지 않아요. 이 작업을 떠나면 대화가 사라져요.",
  chatOnly: "대화만 할 수 있어요. AI가 파일을 만들거나 바꾸지 않아요.",
  service: "질문과 답은 답을 만들기 위해 서비스로 보내져요.",
} as const;

/**
 * The turn's profile in a temporary task: chat only. Of the SDK tools only `read` survives (reading the work folder
 * leaves no trace); write, shell, browser and subagents are dropped, browser control is off (no page actions or
 * downloads), the orchestrator roster is gone, and so is `observation` (no learning record of the turn).
 */
export function temporaryTaskProfile(profile: ResolvedProfile): ResolvedProfile {
  const { orchestrator: _orchestrator, observation: _observation, sdk_tools, browser_control, ...rest } = profile;
  return { ...rest, ...(sdk_tools?.read ? { sdk_tools: { read: true } } : {}), ...(browser_control ? { browser_control: { ...browser_control, enabled: false } } : {}) };
}
