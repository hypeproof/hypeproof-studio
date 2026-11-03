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

/**
 * CGP-KNOW-R-007 / REQ-KNOW-10: the separate public-audience decision, asked only after the content checklist was
 * approved. It carries no item list: the only answer that publishes is this one acknowledgement id, never an item set.
 */
export const PUBLIC_AUDIENCE_ACK = "public-audience";
export const PUBLIC_AUDIENCE_LABEL = "인터넷의 누구나";
export const CLASS_AUDIENCE_LABEL = "우리 반";
export interface PublicAudiencePrompt { id: string; step: "public"; audience: string; notAudience: string; recipient: string }
export type OutboundStep = "content" | "public";
export type AnyOutboundPrompt = OutboundPrompt | PublicAudiencePrompt;
export const isPublicAudiencePrompt = (prompt: AnyOutboundPrompt): prompt is PublicAudiencePrompt => (prompt as PublicAudiencePrompt).step === "public";
export function publicAudiencePrompt(id: string, manifest: OutboundManifest): PublicAudiencePrompt | null {
  if (!id || manifest.public !== true || outboundDetails(manifest) === null) return null;
  return { id, step: "public", audience: PUBLIC_AUDIENCE_LABEL, notAudience: CLASS_AUDIENCE_LABEL, recipient: outboundLabel(manifest.recipient) };
}

export interface OutboundApprovalPorts {
  scope(): string;
  id(): string;
  /** Show (prompt) or clear (null). `true` only when a visible panel received it. */
  present(prompt: AnyOutboundPrompt | null): Promise<boolean | void>;
}

/** Single flight, scope bound, never remembered. `null`: the panel could not show it (the caller may fall back). */
export class OutboundApproval {
  private pending?: { id: string; scope: string; ids: string[]; finish: (value: boolean | null) => void };
  private readonly ports: OutboundApprovalPorts;
  private readonly timeoutMs: number;
  constructor(ports: OutboundApprovalPorts, timeoutMs = 180_000) { this.ports = ports; this.timeoutMs = timeoutMs; }
  confirm(manifest: OutboundManifest, step: OutboundStep = "content"): Promise<boolean | null> {
    if (this.pending) return Promise.resolve(false);
    const frozen = structuredClone(manifest);
    const prompt: AnyOutboundPrompt | null = step === "public" ? publicAudiencePrompt(this.ports.id(), frozen) : outboundPrompt(this.ports.id(), frozen);
    if (!prompt) return Promise.resolve(false);
    const scope = this.ports.scope(), ids = isPublicAudiencePrompt(prompt) ? [PUBLIC_AUDIENCE_ACK] : outboundPromptItemIds(prompt);
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
