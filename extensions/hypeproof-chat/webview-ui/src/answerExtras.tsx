// A seam on a completed answer for controls that are not part of the text flow (the sibling of
// composerAddon.ts). The answer draws `<AnswerExtras>` where an extra control may sit and knows nothing
// about what is behind it. Nothing registered means nothing drawn: a seat without extras renders exactly
// what it rendered before.
//
// A plain registry, not a React context: this module is imported by ChatDetails, which several tests
// load against a stub React that has hooks but no createContext, so it must do nothing at import time.
import type { ComponentType } from "react";

export interface AnswerExtrasProps { answerId: string; content: string }

let registered: ComponentType<AnswerExtrasProps> | null = null;

/** Called once, at import time, by the module that owns the extra control. */
export function registerAnswerExtras(component: ComponentType<AnswerExtrasProps> | null): void { registered = component; }

export function AnswerExtras(props: AnswerExtrasProps) {
  const Extra = registered;
  return Extra ? <Extra {...props} /> : null;
}
