import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * CGP-SHELL-R-011 (REQ-STUDIO-OFFLINE-BANNER): the chat panel says when the network is gone and
 * what still works. The webview only watches `navigator.onLine` and the window `online`/`offline`
 * events. Nothing here sends: on reconnect the learner presses send again, and the existing
 * parked-message queue keeps firing only on the stream's end edge (sendQueue.ts).
 *
 * The state logic is DOM-free so test/offline-banner.test.tsx can drive it with a plain EventTarget.
 */

export const OFFLINE_BANNER_TEXT = '인터넷 연결이 끊겼어요. 만든 파일과 쓰던 글은 그대로 있어요. 연결되면 다시 보낼 수 있어요.';
export const ONLINE_ANNOUNCEMENT = '인터넷이 다시 연결됐어요. 이제 보낼 수 있어요.';

/** The held-send note names where the learner's words actually are on each path. */
export const OFFLINE_HELD_NOTES = {
  /** Composer send and the roll-input send: the text is still in the composer. */
  draft: '지금은 인터넷이 끊겨서 보내지 않았어요. 쓴 글은 입력창에 그대로 있어요.',
  /** Edit and resend: the text is still in the open edit box. */
  edit: '지금은 인터넷이 끊겨서 보내지 않았어요. 고친 글은 수정 칸에 그대로 있어요.',
  /** Retrying a kept (recovered) message: the message is still in its kept row. */
  kept: '지금은 인터넷이 끊겨서 보내지 않았어요. 보관한 메시지는 그대로 있어요.',
  /** A press with nothing typed (friend pick, ask again, retry-last, product test). */
  press: '지금은 인터넷이 끊겨서 보내지 않았어요. 연결되면 다시 눌러 주세요.',
} as const;
export type HeldNoteKind = keyof typeof OFFLINE_HELD_NOTES;

/** How long the reconnect line stays in the live region before it is cleared. */
export const ONLINE_ANNOUNCEMENT_MS = 4000;

export type ConnectivityState = { online: boolean; announcement: string };
export type ConnectivityEvent = 'online' | 'offline';

/** Only an explicit `false` means offline; an unknown state never blocks the learner. */
export function readOnline(nav: { onLine?: boolean } | undefined): boolean {
  return nav?.onLine !== false;
}

/** Same state object back when nothing changed, so a repeated event announces nothing. */
export function connectivityStep(state: ConnectivityState, event: ConnectivityEvent): ConnectivityState {
  if (event === 'offline') return state.online ? { online: false, announcement: '' } : state;
  return state.online ? state : { online: true, announcement: ONLINE_ANNOUNCEMENT };
}

/** While offline a send is held; the draft stays where it is. */
export function offlineHoldsSend(online: boolean): boolean {
  return !online;
}

/**
 * The one gate every learner send goes through. Offline: `send` is not called, `onHeld` shows the
 * note, and the caller keeps its draft or choice. Online: a host refusal (`false`) passes through.
 */
export function guardSend(online: boolean, send: () => unknown, onHeld: () => void): boolean {
  if (offlineHoldsSend(online)) { onHeld(); return false; }
  return send() !== false;
}

/**
 * Subscribe to connectivity changes. Re-reads `nav.onLine` once the listeners are attached, in
 * both directions: the network can drop, or come back, between the first render and the subscribe.
 */
export function watchConnectivity(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  nav: { onLine?: boolean } | undefined,
  onChange: (online: boolean) => void,
): () => void {
  const onOnline = () => onChange(true);
  const onOffline = () => onChange(false);
  target.addEventListener('online', onOnline);
  target.addEventListener('offline', onOffline);
  onChange(readOnline(nav));
  return () => {
    target.removeEventListener('online', onOnline);
    target.removeEventListener('offline', onOffline);
  };
}

/**
 * One polite live region, several sources (the response lifecycle, the reconnect line). The
 * source that changed to a non-empty line most recently owns the region; when the owner clears,
 * the region clears (an older line is never re-announced). A source clearing while another owns
 * the region changes nothing. Later sources win a tie within one render.
 */
export type LiveRegionState = { values: readonly string[]; owner: number };

export function liveRegionStep(prev: LiveRegionState, values: readonly string[]): LiveRegionState {
  let owner = prev.owner;
  let changed = false;
  values.forEach((value, i) => {
    if (value === (prev.values[i] ?? '')) return;
    changed = true;
    if (value) owner = i;
    else if (owner === i) owner = -1;
  });
  return changed ? { values, owner } : prev;
}

export function liveRegionText(state: LiveRegionState): string {
  return state.owner >= 0 ? state.values[state.owner] ?? '' : '';
}

export function useLiveRegion(values: readonly string[]): string {
  const state = useRef<LiveRegionState>({ values: values.map(() => ''), owner: -1 });
  // A pure, idempotent step: a second render with the same values returns the same state.
  state.current = liveRegionStep(state.current, values);
  return liveRegionText(state.current);
}

function currentNavigator(): { onLine?: boolean } | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}
const onlineSnapshot = () => readOnline(currentNavigator());
const subscribeOnline = (notify: () => void) =>
  typeof window === 'undefined' || typeof window.addEventListener !== 'function'
    ? () => {}
    : watchConnectivity(window, currentNavigator(), () => notify());

/** Shared by App and ChatPanel: React re-reads the snapshot after subscribing, so no edge is missed. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, onlineSnapshot, onlineSnapshot);
}

export function useConnectivity(): ConnectivityState {
  const online = useOnline();
  const [announcement, setAnnouncement] = useState('');
  const prev = useRef(online);
  useEffect(() => {
    const step = connectivityStep({ online: prev.current, announcement: '' }, online ? 'online' : 'offline');
    prev.current = online;
    setAnnouncement(step.announcement);
  }, [online]);
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), ONLINE_ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [announcement]);
  return { online, announcement };
}
