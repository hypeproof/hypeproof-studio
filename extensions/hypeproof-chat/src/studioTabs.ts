import * as vscode from "vscode";
import { StudioTabLedger } from "./linkNavigationGuard";

/** CGP-SHELL-R-026 — every browser tab Studio opens goes through here, so a page-opened tab can be told apart. */
export const studioTabs = new StudioTabLedger();

export function openStudioTab(url: string, options?: vscode.BrowserTabShowOptions): Thenable<vscode.BrowserTab> {
  studioTabs.note(url);
  return vscode.window.openBrowserTab(url, options);
}
