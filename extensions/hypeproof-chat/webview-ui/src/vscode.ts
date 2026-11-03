import type { LocalReviewRequest } from "../../src/localReviewProtocol";
import type { HostMessage, WebviewMessage } from "../../src/protocol";

interface VSCodeApi {
  postMessage(msg: WebviewMessage | LocalReviewRequest): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VSCodeApi;
  }
}

let api: VSCodeApi | null = null;
let activityId: string | undefined;
let taskId: string | undefined;
if (typeof window.acquireVsCodeApi === "function") {
  api = window.acquireVsCodeApi();
}

export function postToHost(msg: WebviewMessage): void {
  if (api) api.postMessage({...msg, ...(activityId && !msg.activityId ? {activityId} : {}), ...(taskId && !msg.taskId ? {taskId} : {})});
  else console.warn("[hypeproof-chat] no vscode api — running outside webview?", msg.type);
}

export function onHostMessage(handler: (m: HostMessage) => void): () => void {
  const listener = (ev: MessageEvent) => {
    const msg=ev.data as HostMessage;
    if(msg.type==='config') { activityId=msg.config.activity?.id; taskId=msg.config.taskWorkspace?.activeTaskId ?? undefined; }
    else if(msg.activityId && msg.activityId!==activityId)return;
    else if(msg.taskId && msg.taskId!==taskId)return;
    handler(msg);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function postLocalReview(msg: LocalReviewRequest): void { api?.postMessage(msg); }

/** The webview's own persisted state (survives a reload of the same panel). Outside a webview it is a no-op. */
export function readWebviewState<T extends object>(): Partial<T> {
  try { const state = api?.getState<T>(); return state && typeof state === "object" ? state : {}; } catch { return {}; }
}
export function patchWebviewState(patch: object): void {
  try { api?.setState({ ...readWebviewState(), ...patch }); } catch { /* state is a convenience, never required */ }
}
