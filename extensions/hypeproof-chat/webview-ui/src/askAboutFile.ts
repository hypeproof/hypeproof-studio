// CGP-KNOW-R-015 (REQ-STUDIO-ASK-ABOUT-FILE) — "이 파일에 대해 묻기". The webview only offers the
// action and names the file; the host attaches it through the CGP-CHAT-R-011 path
// (fileAttachment.ts) with every check, then focuses the composer.

import type { ChatConfig } from "../../src/protocol";

export const ASK_ABOUT_FILE_LABEL = "이 파일에 대해 묻기";

/** The same grant as "작업 폴더 파일 붙이기": the host's `fileAttach` flag, never the instructor surface. */
export function askAboutFileAllowed(config: Pick<ChatConfig, "fileAttach" | "isInstructor"> | null | undefined): boolean {
  return config?.fileAttach === true && config.isInstructor !== true;
}
