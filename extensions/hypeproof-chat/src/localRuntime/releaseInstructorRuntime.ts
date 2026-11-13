// The release app's instructor runner gate (#3597, chalk#14). Separate from the Dev-only gate
// (localRuntimeConfig in index.ts), which stays as it is. Closed unless every condition holds.
import { isAbsolute } from "node:path";
import type { LocalRuntimeConfig } from "./index.ts";
import type { CliProvider } from "./cliLocate.ts";

export type ReleaseGateReason =
  | "not_instructor"
  | "student_slot"
  | "setting_off"
  | "rehearsal"
  | "no_cli"
  | "relative_path"
  | "login_failed";

export interface ReleaseGateInput {
  /** Server-verified instructor mode (whoami), not a token guess. */
  isInstructor: boolean;
  panelMode: string;
  /** The profile is a learner-condition rehearsal code. Closed in this version (decision: rehearsal refused). */
  rehearsal: boolean;
  /** The hypeproofChat.instructorSubscription setting. Default false, machine scope. */
  setting: boolean;
}

export interface ReleaseGateDeps {
  locate(provider: CliProvider): string | null;
  loginOk(executable: string, provider: CliProvider): Promise<boolean>;
}

const MODEL: Record<CliProvider, string> = { claude: "sonnet", codex: "default" };
const LABEL: Record<CliProvider, string> = { claude: "Claude Code", codex: "Codex" };
const PROVIDER_ORDER: readonly CliProvider[] = ["claude", "codex"];

export async function releaseInstructorRuntime(
  input: ReleaseGateInput,
  deps: ReleaseGateDeps,
): Promise<{ ok: true; config: LocalRuntimeConfig } | { ok: false; reason: ReleaseGateReason }> {
  if (!input.isInstructor) return { ok: false, reason: "not_instructor" };
  if (input.panelMode !== "instructor") return { ok: false, reason: "student_slot" };
  if (!input.setting) return { ok: false, reason: "setting_off" };
  if (input.rehearsal) return { ok: false, reason: "rehearsal" };
  for (const provider of PROVIDER_ORDER) {
    const executable = deps.locate(provider);
    if (!executable) continue;
    if (!isAbsolute(executable)) return { ok: false, reason: "relative_path" };
    if (!(await deps.loginOk(executable, provider))) return { ok: false, reason: "login_failed" };
    const model = MODEL[provider];
    return {
      ok: true,
      config: { provider, executable, model, label: `${LABEL[provider]} · 로컬 구독 · ${model}` },
    };
  }
  return { ok: false, reason: "no_cli" };
}

/** The learner-facing sentence for a closed reason, shown only to the instructor. No numbers, no paths, no output. */
export function releaseGateNotice(reason: ReleaseGateReason): string {
  switch (reason) {
    case "no_cli":
      return "내 구독을 쓰려면 Claude 또는 Codex 명령줄 도구를 먼저 설치하세요.";
    case "login_failed":
      return "내 구독 계정으로 로그인되어 있지 않아요. 명령줄 도구에서 로그인한 뒤 다시 시도하세요.";
    case "relative_path":
      return "설치된 명령줄 도구의 위치를 확인할 수 없어요. 다시 설치한 뒤 시도하세요.";
    default:
      return "";
  }
}

/**
 * The release runner is an instructor-turn resource only (#3608 review). A learner turn never receives it,
 * even when the gate was open before the panel changed: `isInstructor` is the same decision the instructor branch uses.
 */
export function instructorLocalRuntime(isInstructor: boolean, release: LocalRuntimeConfig | null): LocalRuntimeConfig | null {
  return isInstructor ? release : null;
}

/**
 * A gate closed for a missing CLI or a failed login may open after the instructor installs or logs in (the inputs
 * do not change), so the next instructor turn checks again. Other closed reasons are decided by the seat, not the CLI.
 */
export function shouldRecheckRelease(reason: string | undefined): boolean {
  return reason === "no_cli" || reason === "login_failed";
}
