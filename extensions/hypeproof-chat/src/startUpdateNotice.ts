/**
 * REQ-STUDIO-START-UPDATE-NOTICE (Jay 2026-10-29, "첫 기본화면에서도 새버전이 뜨도록해야하는데") — the
 * start page shows the update offer the chat banner shows. Pure: no VS Code API, no DOM. The offer and
 * its dismissal rule come from the update scheduler (`shouldShowBanner`, 7 days per version); the class
 * hold is the chat banner's (CGP-SHELL-R-001). Start-page register (합니다체), one short line.
 */
export const START_UPDATE_COPY = {
  title: "새 버전이 나왔습니다",
  body: "업데이트하면 Studio가 다시 시작됩니다.",
  held: "수업이 끝나면 설치할 수 있습니다.",
  install: "업데이트",
  later: "나중에",
} as const;

/** What the notice draws: the version label and whether its buttons are shown. Null draws nothing. */
export function startUpdateNotice(update: { version?: unknown; heldForClass?: unknown } | null | undefined): { version: string; held: boolean } | null {
  if (!update || typeof update.version !== "string" || !update.version) return null;
  return { version: `v${update.version.replace(/^v/, "")}`, held: update.heldForClass === true };
}
