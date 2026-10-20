// How much of the coach's tool work the chat timeline draws. #414 draws every SDK tool call as
// its own raw line (`Edit(index.html)`, `mcp__hypeproof__browser_read({})`), a failed call with
// the SDK's error text (`— 실패: <tool_use_error>String to replace not found…`), and the
// coach's thinking.
//
// The Service decides per cohort (`tool_activity` on /v1/profile, hype-dental D-027,
// 2026-10-14). "summary" keeps one live Korean line per stretch of work ("홈페이지를 고치는
// 중…"), changed in place and hidden once the stretch ends: no tool names, no thinking text, no
// line for a failed call the coach retries on its own. Absent or any other value → "detailed",
// the #414 behaviour. Only what is drawn changes; observation and the spool record the same.
// Pure, no `vscode`.

export type ToolActivityMode = "detailed" | "summary";

export function toolActivityMode(profile: { tool_activity?: unknown } | null | undefined): ToolActivityMode {
  return profile?.tool_activity === "summary" ? "summary" : "detailed";
}

export interface WorkPhrase {
  icon: string;
  label: string;
}

export const THINKING_PHRASE: WorkPhrase = { icon: "💭", label: "생각하는 중…" };
export const NEXT_STEP_PHRASE: WorkPhrase = { icon: "…", label: "다음 단계를 준비하는 중…" };
export const PREVIEW_PHRASE: WorkPhrase = { icon: "🖼️", label: "미리보기를 여는 중…" };

/** The line a tool call becomes in summary mode. Never echoes the tool's name or its input. */
export function workPhrase(name: string, input: unknown): WorkPhrase {
  const fp = (input as { file_path?: unknown } | null | undefined)?.file_path;
  const file = typeof fp === "string" ? fp : "";
  const bare = name.replace(/^mcp__.+?__/, "");
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(name)) {
    if (/\.html?$/i.test(file)) return { icon: "✍️", label: "홈페이지를 고치는 중…" };
    if (/(^|[\\/])agent\.md$/i.test(file)) return { icon: "📝", label: "agent.md에 정리하는 중…" };
    return { icon: "✍️", label: "파일을 고치는 중…" };
  }
  if (["Read", "Grep", "Glob", "LS"].includes(name)) return { icon: "🔍", label: "파일을 살펴보는 중…" };
  if (/^(browser_|live_preview_)/.test(bare)) return { icon: "🖥️", label: "화면을 확인하는 중…" };
  if (["Bash", "BashOutput", "PowerShell"].includes(name)) return { icon: "⌨️", label: "명령을 실행하는 중…" };
  if (["WebSearch", "WebFetch"].includes(name)) return { icon: "🌐", label: "인터넷에서 찾아보는 중…" };
  return { icon: "🔧", label: "작업하는 중…" };
}

export interface WorkLineEntry {
  id: string;
  icon: string;
  label: string;
  state: "running" | "done";
  /** REQ-STUDIO-LONG-STEP-HINT — set only while the line stands for one tool step. */
  step?: string;
  since?: number;
}

/**
 * Summary mode's one line. `show` opens it or changes it in place; `close` marks it done, which
 * the timeline hides (ids under `pending-`, see ToolLine). The next `show` opens a new id so the
 * line appears at the bottom again instead of reviving the old one above text the coach wrote
 * since (the timeline replaces a known id where it stands).
 */
export class WorkLine {
  private seq = 0;
  private openLabel: string | null = null;
  private openSince: number | undefined = undefined;
  /** REQ-STUDIO-LONG-STEP-HINT — tool steps that have started (approved) and not ended. */
  private readonly steps = new Map<string, { phrase: WorkPhrase; since: number }>();
  private readonly baseId: string;
  private readonly post: (entry: WorkLineEntry) => void;

  constructor(baseId: string, post: (entry: WorkLineEntry) => void) {
    this.baseId = baseId;
    this.post = post;
  }

  get isOpen(): boolean {
    return this.openLabel !== null;
  }

  /**
   * A phrase with no clock (thinking, the next step, a tool waiting for its approval). While a
   * started step still runs, the line keeps showing that step instead: a parallel call that ended
   * must not take the hint away from a build that is still going.
   */
  show(phrase: WorkPhrase): void {
    if (this.steps.size > 0) return;
    this.render(phrase);
  }

  /** The tool actually started (its approval resolved): the line shows the longest-running step. */
  startStep(id: string, phrase: WorkPhrase, since: number): void {
    this.steps.set(id, { phrase, since });
    this.renderOldest();
  }

  /** The tool ended. Returns true while another started step still runs (the line stays on it). */
  endStep(id: string): boolean {
    if (this.steps.delete(id) && this.steps.size > 0) this.renderOldest();
    return this.steps.size > 0;
  }

  close(label: string): void {
    this.steps.clear();
    if (this.openLabel === null) return;
    this.openLabel = null;
    this.openSince = undefined;
    this.post({ id: this.id(), icon: "✍️", label, state: "done" });
    this.seq += 1;
  }

  private renderOldest(): void {
    let oldest: { phrase: WorkPhrase; since: number } | undefined;
    for (const step of this.steps.values()) if (!oldest || step.since < oldest.since) oldest = step;
    if (oldest) this.render(oldest.phrase, oldest.since);
  }

  private render(phrase: WorkPhrase, since?: number): void {
    if (this.openLabel === phrase.label && this.openSince === since) return;
    this.openLabel = phrase.label;
    this.openSince = since;
    this.post({ id: this.id(), icon: phrase.icon, label: phrase.label, state: "running", ...(since !== undefined ? { step: phrase.label, since } : {}) });
  }

  private id(): string {
    return `${this.baseId}-w${this.seq}`;
  }
}
