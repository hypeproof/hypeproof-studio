// Studio voice, the webview's one source of truth for "is voice on here, and has the learner read the
// disclosure". Everything voice draws asks this context; with no `voice` block on the served profile
// the availability is `none` and nothing draws (voiceServed.ts).
//
// `useVoiceController` is called once, by App; `VoiceProvider` hands its value to the tree and draws
// the disclosure sheet when a press needs it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ResolvedProfile } from "../../src/protocol";
import { readsMinorDisclosure, voiceAvailability, type VoiceAvailability } from "../../src/voiceServed";
import { onHostMessage, postToHost } from "./vscode";
import { VoiceDisclosureSheet } from "./VoiceDisclosureSheet";
import { registerAnswerExtras } from "./answerExtras";
import { ReadAloudButton } from "./ReadAloudButton";

export interface VoiceContextValue {
  availability: VoiceAvailability;
  /** Run `go` now when this policy version's disclosure was read, else show the sheet and run it on 시작하기. */
  gate(go: () => void, automatic?: boolean): void;
  /** A Service refusal said this class has voice off: show the D-018 state from now on. */
  markClassOff(): void;
}
export interface VoiceController {
  value: VoiceContextValue;
  sheet: { go: () => void; automatic: boolean; scope: string } | null;
  closeSheet(): void;
  accept(): void;
  minor: boolean;
}

// The read-aloud control goes on every completed answer; it draws nothing unless voice is served (useVoice).
registerAnswerExtras(ReadAloudButton);

const NONE: VoiceContextValue = { availability: { kind: "none" }, gate: () => {}, markClassOff: () => {} };
const VoiceContext = createContext<VoiceContextValue>(NONE);
export const useVoice = (): VoiceContextValue => useContext(VoiceContext);

/** Seats this window has seen served voice. In memory: it is what tells "turned off mid-session" from "never had it". */
const servedBefore = new Set<string>();

export function useVoiceController(profile: ResolvedProfile | null | undefined, scopeKey: string, enabled: boolean): VoiceController {
  const [refused, setRefused] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<{ go: () => void; automatic: boolean; scope: string } | null>(null);
  const raw = voiceAvailability(enabled ? profile : null, servedBefore.has(scopeKey), refused === scopeKey);
  // A stable object while nothing about it changed: consumers re-render on a real change only.
  const key = raw.kind === "on" ? `on:${raw.served.dictation}:${raw.served.readAloud}:${raw.served.policyVersion}` : raw.kind;
  const availability = useMemo(() => raw, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Record that this seat was served, after the render that saw it.
  useEffect(() => { if (availability.kind === "on") servedBefore.add(scopeKey); }, [availability, scopeKey]);
  const version = availability.kind === "on" ? availability.served.policyVersion : null;

  // Which disclosure versions were read: asked once, and only when voice is on.
  // The host answers for the current seat; a seat switch asks again and forgets the last answer.
  useEffect(() => {
    setAcknowledged(null);
    if (!version) return;
    const off = onHostMessage((m) => { if (m.type === "voiceDisclosureState") setAcknowledged(m.acknowledged); });
    postToHost({ type: "voiceDisclosureRead" });
    return off;
  }, [version, scopeKey]);

  const gate = useCallback((go: () => void, automatic = false) => {
    if (!version) return;
    if (acknowledged?.includes(version)) { go(); return; }
    setSheet({ go, automatic, scope: scopeKey });
  }, [version, acknowledged, scopeKey]);
  const markClassOff = useCallback(() => setRefused(scopeKey), [scopeKey]);
  const value = useMemo<VoiceContextValue>(() => ({ availability, gate, markClassOff }), [availability, gate, markClassOff]);

  const accept = useCallback(() => {
    if (!sheet || !version) return;
    if (sheet.scope !== scopeKey) { setSheet(null); return; }
    const next = sheet.go;
    setSheet(null);
    postToHost({ type: "voiceDisclosureAck", policyVersion: version });
    // Remember it for this window too; the host's answer follows.
    setAcknowledged((list) => (list?.includes(version) ? list : [...(list ?? []), version]));
    next();
  }, [sheet, version, scopeKey]);
  const closeSheet = useCallback(() => setSheet(null), []);
  return { value, sheet, closeSheet, accept, minor: readsMinorDisclosure(profile) };
}

export function VoiceProvider({ controller, children }: { controller: VoiceController; children: ReactNode }) {
  const { value } = controller;
  return (
    <VoiceContext.Provider value={value}>
      {children}
      {controller.sheet && value.availability.kind === "on" && (
        <VoiceDisclosureSheet served={value.availability.served} minor={controller.minor} automatic={controller.sheet.automatic} onStart={controller.accept} onCancel={controller.closeSheet} />
      )}
    </VoiceContext.Provider>
  );
}
