export interface ContinuationPayload {
  projectLabel: string;
  selectedText: Array<{ label: string; text: string }>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  draft: string;
  model?: string;
}

export interface ClaudeDisclosure {
  provider: 'Anthropic';
  recipient: 'api.anthropic.com';
  account: string;
  organization?: string;
  authMethod: string;
  funding: string;
  billingNotice: string;
}

export interface ContinuationInspection {
  status: 'ready' | 'blocked';
  code: string;
  version?: string;
  disclosure?: ClaudeDisclosure;
  manualCommand: 'claude';
}

export interface ContinuationSnapshot {
  digest: string;
  generation: number;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  disclosure: ClaudeDisclosure;
  expiresAt: number;
}

export type ContinuationResult = {
  status: 'success' | 'quota' | 'offline' | 'auth' | 'error' | 'cancelled' | 'stale' | 'blocked';
  code: string;
  requestId?: string;
  text?: string;
};

export interface ContinuationTransport {
  inspect(signal: AbortSignal): Promise<ContinuationInspection>;
  request(snapshot: Readonly<ContinuationSnapshot>, signal: AbortSignal): Promise<ContinuationResult>;
}
