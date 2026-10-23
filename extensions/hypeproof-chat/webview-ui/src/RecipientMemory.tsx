import { RECIPIENT_AI_MEMORY_UNKNOWN } from '../../src/outboundConsent';
import { ChatIcon } from './ChatDetails';
import './recipientMemory.css';

/** DES-KNOW-33: no receiver policy exists in the pinned contract; never infer a safe state. */
export function RecipientMemory({ className = '' }: { className?: string }) {
  return <p className={`hps-recipient-memory ${className}`} data-recipient-ai-memory data-memory-policy="unknown">
    <span data-recipient-ai-memory-icon aria-hidden="true"><ChatIcon kind="info" size={16} /></span>
    <span>{RECIPIENT_AI_MEMORY_UNKNOWN}</span>
  </p>;
}
