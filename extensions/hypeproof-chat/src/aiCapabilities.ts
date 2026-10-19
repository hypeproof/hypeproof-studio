/**
 * CGP-AGENT-R-003: what the AI can do in this lesson, in the learner's words. One row per REQ-M38
 * feature key, derived from the same profile fields and runtime the host uses to grant tools, so
 * the card never lists a capability the seat does not have (AE-07: the role intro must not
 * over-promise). File and command tools exist only on the agent-sdk runtime.
 */
import type { ResolvedProfile } from "./protocol";

export type AiCapabilityKey = "read" | "write" | "shell" | "subagents" | "browser" | "web_search";
export interface AiCapability { key: AiCapabilityKey; label: string; on: boolean }

export const AI_CAPABILITY_LABELS: Record<AiCapabilityKey, string> = {
  read: "작업 폴더의 파일 읽기",
  write: "작업 폴더의 파일 고치기",
  shell: "명령 실행하기 (실행 전에 물어봐요)",
  subagents: "다른 도우미 AI에게 일 나눠 맡기기",
  browser: "Studio 브라우저로 페이지 열고 살펴보기",
  web_search: "웹에서 찾아보기",
};

export function aiCapabilities(
  profile: Pick<ResolvedProfile, "sdk_tools" | "tools" | "browser_control"> | null | undefined,
  runtime: "proxy" | "agent-sdk",
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
  return (Object.keys(AI_CAPABILITY_LABELS) as AiCapabilityKey[]).map((key) => ({ key, label: AI_CAPABILITY_LABELS[key], on: on[key] }));
}
