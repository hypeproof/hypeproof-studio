/**
 * CGP-SHELL-R-026 (REQ-SHELL-26, DES-SHELL-25) — the confirm dialog before an external link opens. Presentation is the
 * chat webview's LinkConfirmDialog (취소 is the initial focus and Enter on it cancels; a native VS Code modal always makes
 * its first non-cancel button the default, so it cannot). Pure and vscode-free: the host owns the URL policy
 * (browserSafetyHelpers.routeExternalLink), focuses the chat and presents through `ports`.
 *
 * One prompt at a time. A second request while one is open, a seat change, a timeout or a webview that cannot show the
 * prompt all resolve as 'cancel': nothing opens (fail closed).
 */
export interface LinkConfirmPrompt {
  id: string;
  /** The host in ASCII (punycode for IDN), middle-ellipsized past 48 characters; drawn bold on its own line. */
  host: string;
  /** The decoded host when it differs from `host` (an IDN), else null. */
  unicodeHost: string | null;
  /** The host has an IDN label or mixes scripts: the dialog says it may imitate another site. */
  warning: boolean;
  /** The full address, never shortened; it wraps. */
  url: string;
  /** Where 열기 opens it. */
  where: "integrated" | "system";
  /** Where the click came from (the dialog names a link from a page Studio made). */
  source: "chat" | "preview" | "browser";
}
export type LinkConfirmChoice = "open" | "copy" | "cancel";

export const LINK_CONFIRM_COPY = {
  title: "바깥 사이트를 열까요?",
  hostLabel: "열 주소",
  unicodeLabel: "이렇게도 보여요:",
  warning: "다른 사이트를 흉내 낸 주소일 수 있어요. 주소를 한 글자씩 확인해 주세요.",
  fromPreview: "미리 보기 화면에 있던 링크예요.",
  whereIntegrated: "Studio 브라우저에서 열려요.",
  whereSystem: "컴퓨터의 기본 브라우저에서 열려요.",
  cancel: "취소",
  open: "열기",
  copy: "링크 복사",
  unavailable: "링크를 열기 전에 확인이 필요해요. Studio 대화창을 열고 다시 눌러 주세요.",
  busy: "먼저 열린 링크 확인 창에 답해 주세요.",
  blocked: "이 창에서는 수업 허용 목록 밖의 사이트를 열 수 없어요. 선생님께 알려 주세요.",
  /** Jay, 2026-11-15: an AI-made (loopback) page tried to send data to another site, on a minor seat. */
  outbound: "이 페이지가 다른 사이트로 정보를 보내려 해서 막았어요.",
} as const;

export class LinkConfirmRequest {
  private pending?: { prompt: LinkConfirmPrompt; scope: string; finish(choice: LinkConfirmChoice): void };
  private readonly ports: { scope(): string; present(prompt: LinkConfirmPrompt | null): Promise<boolean | void> };
  private readonly timeoutMs: number;
  constructor(ports: { scope(): string; present(prompt: LinkConfirmPrompt | null): Promise<boolean | void> }, timeoutMs = 120_000) {
    this.ports = ports; this.timeoutMs = timeoutMs;
  }
  confirm(prompt: LinkConfirmPrompt): Promise<LinkConfirmChoice> {
    if (this.pending && this.pending.scope !== this.ports.scope()) this.cancel();
    if (this.pending || !prompt.id) return Promise.resolve("cancel");
    const frozen = { ...prompt }, scope = this.ports.scope();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.cancel(), this.timeoutMs);
      this.pending = { prompt: frozen, scope, finish: (choice) => { clearTimeout(timer); this.pending = undefined; void this.ports.present(null).catch(() => {}); resolve(choice); } };
      void this.ports.present(frozen)
        .then((shown) => { if (shown !== true && this.pending?.prompt.id === frozen.id) this.cancel(); })
        .catch(() => { if (this.pending?.prompt.id === frozen.id) this.cancel(); });
    });
  }
  respond(id: unknown, choice: unknown): void {
    const pending = this.pending;
    if (!pending || id !== pending.prompt.id) return;
    if (pending.scope !== this.ports.scope()) { this.cancel(); return; }
    if (choice === "open" || choice === "copy" || choice === "cancel") pending.finish(choice);
  }
  get open(): boolean { return !!this.pending; }
  cancel(): void { this.pending?.finish("cancel"); }
}
