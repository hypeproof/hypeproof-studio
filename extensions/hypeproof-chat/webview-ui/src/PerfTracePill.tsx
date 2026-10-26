// CGP-AGENT-D-026 (DES-CGP-AGENT-64, REQ-STUDIO-PERF-TRACE) — the red "기록 중 · 멈추기" pill shown above the
// composer while a 느려요 기록 runs. The host owns the recording; the pill shows only what the host said
// (`perfTraceState`) and asks again on mount, so a reloaded panel finds a running recording. A press sends
// the recording's own id back, so a stale pill can never stop a later recording, and a second press while
// the stop is on its way does nothing. The start dialog and the review stay native modals (perfTraceHost.ts).

import { useEffect, useState } from "react";
import { ChatIcon } from "./ChatDetails";
import { onHostMessage, postToHost } from "./vscode";
import { PERF_TRACE_PANEL_PILL, PERF_TRACE_PILL_LABEL } from "../../src/perfTrace";

export function PerfTracePill() {
  const [id, setId] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type !== "perfTraceState") return;
      setId(msg.recording === true && typeof msg.id === "string" ? msg.id : null);
    });
    postToHost({ type: "perfTraceStateRequest" });
    return off;
  }, []);
  if (!id) return null;
  const pending = stopping === id;
  return (
    <div className="hps-perf-trace-pill-row" data-testid="perf-trace-pill-row">
      <button type="button" className="hps-perf-trace-pill" data-perf-trace-pill aria-label={PERF_TRACE_PILL_LABEL} aria-disabled={pending || undefined}
        onClick={() => { if (pending) return; setStopping(id); postToHost({ type: "perfTraceStop", id }); }}>
        <ChatIcon kind="stop" size={16} />
        <span>{PERF_TRACE_PANEL_PILL}</span>
      </button>
    </div>
  );
}
