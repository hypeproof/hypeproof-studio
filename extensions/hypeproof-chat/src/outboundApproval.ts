import { OUTBOUND_EXCLUDED, outboundDetails, outboundLabel, type OutboundManifest } from "./outboundConsent.ts";

/**
 * CGP-KNOW-D-006 / DES-KNOW-09: the in-panel presentation of one CGP-KNOW-R-006 manifest.
 * The manifest stays the producer's immutable payload; this only asks for one explicit decision over it.
 */
export interface OutboundPromptItem { id: string; label: string; bytes: number; memory?: true }
export interface OutboundPromptSection { recipient: string; items: OutboundPromptItem[] }
export interface OutboundPrompt { id: string; public: boolean; notes: string[]; sections: OutboundPromptSection[]; excluded: string }

/** Freeze a manifest into the prompt the webview draws. Every item gets a stable, unique id. Null when R-006 would refuse it. */
export function outboundPrompt(id: string, manifest: OutboundManifest): OutboundPrompt | null {
  if (!id || outboundDetails(manifest) === null) return null;
  const sections = [manifest, ...(manifest.also ?? [])].map((s, si) => ({
    recipient: outboundLabel(s.recipient),
    items: s.items.map((item, ii) => ({ id: `${si}:${ii}`, label: outboundLabel(item.name), bytes: item.bytes, ...(item.memory === true ? { memory: true as const } : {}) })),
  }));
  return { id, public: manifest.public === true, notes: (manifest.notes ?? []).map(outboundLabel), sections, excluded: OUTBOUND_EXCLUDED };
}
export const outboundPromptItemIds = (prompt: OutboundPrompt): string[] => prompt.sections.flatMap(s => s.items.map(i => i.id));

export interface OutboundApprovalPorts {
  scope(): string;
  id(): string;
  /** Show (prompt) or clear (null). `true` only when a visible panel received it. */
  present(prompt: OutboundPrompt | null): Promise<boolean | void>;
}

/** Single flight, scope bound, never remembered. `null`: the panel could not show it (the caller may fall back). */
export class OutboundApproval {
  private pending?: { id: string; scope: string; ids: string[]; finish: (value: boolean | null) => void };
  private readonly ports: OutboundApprovalPorts;
  private readonly timeoutMs: number;
  constructor(ports: OutboundApprovalPorts, timeoutMs = 180_000) { this.ports = ports; this.timeoutMs = timeoutMs; }
  confirm(manifest: OutboundManifest): Promise<boolean | null> {
    if (this.pending) return Promise.resolve(false);
    const prompt = outboundPrompt(this.ports.id(), structuredClone(manifest));
    if (!prompt) return Promise.resolve(false);
    const scope = this.ports.scope(), ids = outboundPromptItemIds(prompt);
    return new Promise(resolve => {
      const timer = setTimeout(() => this.cancel(), this.timeoutMs);
      this.pending = { id: prompt.id, scope, ids, finish: value => {
        clearTimeout(timer); this.pending = undefined;
        void this.ports.present(null).catch(() => {}); resolve(value);
      } };
      const unshown = () => { if (this.pending?.id === prompt.id) this.pending.finish(null); };
      void this.ports.present(prompt).then(shown => { if (shown !== true) unshown(); }).catch(unshown);
    });
  }
  /** Only the exact full item set of the open prompt, in the scope it opened in, sends. */
  respond(id: unknown, selected: unknown): void {
    const pending = this.pending;
    if (!pending || id !== pending.id) return;
    if (pending.scope !== this.ports.scope()) return this.cancel();
    if (!Array.isArray(selected) || selected.some(x => typeof x !== "string") || new Set(selected).size !== selected.length
      || selected.length !== pending.ids.length || pending.ids.some(x => !selected.includes(x))) return this.cancel();
    pending.finish(true);
  }
  invalidateIfScopeChanged(): void { if (this.pending && this.pending.scope !== this.ports.scope()) this.cancel(); }
  cancel(): void { this.pending?.finish(false); }
}
