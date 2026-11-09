// A seam on a completed answer for controls that are not part of the text flow (the sibling of
// composerAddon.ts). The answer draws `<AnswerExtras>` where an extra control may sit and knows nothing
// about what is behind it. With no provider above it, it draws nothing: a seat without extras renders
// exactly what it rendered before.
import { createContext, useContext, type ComponentType } from "react";

export interface AnswerExtrasProps { answerId: string; content: string }
export const AnswerExtrasContext = createContext<ComponentType<AnswerExtrasProps> | null>(null);

export function AnswerExtras(props: AnswerExtrasProps) {
  const Extra = useContext(AnswerExtrasContext);
  return Extra ? <Extra {...props} /> : null;
}
