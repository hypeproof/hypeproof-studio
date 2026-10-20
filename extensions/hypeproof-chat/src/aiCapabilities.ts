/**
 * CGP-AGENT-R-003: what the AI can do in this lesson, in the learner's words. One row per REQ-M38
 * feature key, derived from the same profile fields and runtime the host uses to grant tools, so
 * the card never lists a capability the seat does not have (AE-07: the role intro must not
 * over-promise). File and command tools exist only on the agent-sdk runtime.
 */
import type { ResolvedProfile } from "./protocol";

export type AiCapabilityKey = "read" | "write" | "shell" | "subagents" | "browser" | "web_search";
export interface AiCapability { key: AiCapabilityKey; label: string; on: boolean; asks?: boolean }

export const AI_CAPABILITY_LABELS: Record<AiCapabilityKey, string> = {
  read: "작업 폴더의 파일 읽기",
  write: "작업 폴더의 파일 고치기",
  shell: "명령 실행하기",
  subagents: "다른 도우미 AI에게 일 나눠 맡기기",
  browser: "Studio 브라우저로 페이지 열고 살펴보기",
  web_search: "웹에서 찾아보기",
};

/** CGP-SHELL-R-024 card copy (REQ-STUDIO-CAPABILITY-CHANGE). Korean is the product; see CLAUDE.md §Language. */
export const CAPABILITY_CHANGE_COPY = {
  title: "이제 AI가 할 수 있는 일이 바뀌었어요",
  added: "새로 생김",
  removed: "이제 안 됨",
  dismiss: "알겠어요",
} as const;

/** One pending card. `id` changes when the content does, so a stale dismiss cannot clear a newer card. */
export interface CapabilityChange { id: string; added: string[]; removed: string[] }

export function aiCapabilities(
  profile: Pick<ResolvedProfile, "sdk_tools" | "tools" | "browser_control"> | null | undefined,
  runtime: "proxy" | "agent-sdk",
  requiredApprovals: readonly string[] = [],
): AiCapability[] {
  const sdk = runtime === "agent-sdk";
  const t = profile?.sdk_tools;
  const on: Record<AiCapabilityKey, boolean> = {
    read: sdk && t?.read === true,
    write: sdk && t?.write === true,
    shell: sdk && t?.shell === true,
    subagents: sdk && t?.subagents === true,
    browser: sdk ? t?.browser === true : profile?.browser_control?.enabled === true,
    web_search: profile?.tools?.web_search === true,
  };
  // Display only: grants still win. Shell has a conditional, non-configurable confirmation path.
  // The browser asks only on the agent-sdk runtime (browser_open approval); the proxy browser loop
  // runs without a per-action modal (browserControl.ts), so there it reads 해요, like any auto-run row.
  // write/delegation/search follow the host's effective settings.
  const asks: Record<AiCapabilityKey, boolean> = {
    read: false,
    write: requiredApprovals.includes("writeFile"),
    shell: true,
    subagents: requiredApprovals.includes("delegateAgent"),
    browser: sdk,
    web_search: sdk && requiredApprovals.includes("webSearch"),
  };
  return (Object.keys(AI_CAPABILITY_LABELS) as AiCapabilityKey[]).map((key) => ({ key, label: AI_CAPABILITY_LABELS[key], on: on[key], ...(on[key] && asks[key] ? { asks: true } : {}) }));
}

/** Denial always wins, even when an older host payload carries an approval hint. */
export function aiCapabilityState(item: AiCapability): string {
  return !item.on ? "안 해요" : item.asks === true ? "물어봐요" : "해요";
}
