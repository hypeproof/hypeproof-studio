// The learner's answer to "may the coach open this address" (#3464). One function for every path that
// opens a browser for the coach, so the rule and the remembered origins cannot drift apart.
import { BLANK_BROWSER_URL, browserOpenUrl, originOfUrl } from "./browserControlHelpers.ts";
import { browserRememberLabel, browserTarget } from "./browserTargetHost.ts";
import type { BrowserApprovalChoice } from "./browserApprovalPrompt.ts";

export interface BrowserOpenPrompt {
  host: string;
  label: string;
  place: "blank" | "preview" | "internet" | "file";
  rememberLabel: string | null;
}

/**
 * Decides one browser open. `remembered` holds the origins the learner chose to remember for this
 * session; a remembered origin is opened without a prompt. Only "remember" adds an origin.
 */
export async function decideBrowserOpen(args: {
  rawUrl: unknown;
  forget: boolean;
  remembered: Set<string>;
  workspaceRoot: string | null;
  confirm: (prompt: BrowserOpenPrompt) => Promise<BrowserApprovalChoice>;
  onPrompted?: () => void;
}): Promise<boolean> {
  const url = browserOpenUrl(args.rawUrl as string | undefined);
  if (!url) return false;
  const target = browserTarget(url, { workspaceRoot: args.workspaceRoot });
  const blank = url === BLANK_BROWSER_URL;
  if (!blank && !target.host) return false;
  const origin = target.web ? originOfUrl(url) : null;
  if (origin && !args.forget && args.remembered.has(origin)) return true;
  const rememberLabel = origin && !args.forget ? browserRememberLabel(url) : null;
  args.onPrompted?.();
  const pick = await args.confirm({
    host: blank ? "빈 브라우저" : target.host!,
    label: blank ? "아직 주소 없음" : target.label,
    place: blank ? "blank" : target.place,
    rememberLabel,
  });
  if (pick === "remember" && origin) { args.remembered.add(origin); return true; }
  return pick === "open";
}
