import * as vscode from "vscode";
import { childRefusalNow, type ChildSurface } from "./childProfile";

/**
 * GRD-09/10/19/24 — a command handler's first line on a child seat: shows the 해요체 refusal and
 * returns true so the handler stops. Returns false (today's behaviour) off a child seat or with the
 * guardian switch off. The manifest is unchanged (no new enablement clause), so this check in the
 * handler is what refuses every caller: menus, the command palette, executeCommand and webview messages.
 */
export function refuseOnChildSeat(surface: ChildSurface): boolean {
  const message = childRefusalNow(surface);
  if (!message) return false;
  void vscode.window.showInformationMessage(message);
  return true;
}
