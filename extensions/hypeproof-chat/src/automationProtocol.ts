/** Browser-safe contract for the email workshop surface. */
export interface AutomationRecipe {
  schema: 'hps-email-automation/1'; title: string; description: string; category: 'email';
  subjectTemplate: string; bodyTemplate: string;
  columns: { email: string; name: string; document: string; dueDate: string };
}
export interface AutomationPreview { id: string; createdAt: number; messages: ReadonlyArray<{ id: string; to: string; subject: string; body: string }> }
export interface AutomationSendRecord { id: string; status: 'sending' | 'sent' | 'unknown' | 'failed'; providerId?: string; error?: string }
export interface AutomationStoreItem { id: string; version: number; formatVersion?: 1; familyId?: string; parentId?: string | null; recipeSha256?: string; title: string; description: string; ownerId: string; updatedAt: string | number; mine: boolean }
export interface AutomationView {
  recipe: AutomationRecipe; sheetUrl: string; range: string; connected: boolean; configured: boolean;
  revocationPending?: boolean;
  busy: boolean; notice: string; error: string | null; preview: AutomationPreview | null;
  records: AutomationSendRecord[]; items: AutomationStoreItem[];
  selected: { item: AutomationStoreItem; recipe: AutomationRecipe } | null;
}
export type AutomationAction =
  | { kind: 'refresh' | 'connect' | 'disconnect' | 'preview' | 'list' | 'authorWithAi' | 'importFile' }
  | { kind: 'edit'; recipe: AutomationRecipe; sheetUrl: string; range: string }
  | { kind: 'send'; previewId: string; reviewed: boolean }
  | { kind: 'publish'; reviewed: boolean }
  | { kind: 'detail' | 'import' | 'unpublish'; id: string };
export function defaultAutomationRecipe(): AutomationRecipe {
  return { schema: 'hps-email-automation/1', category: 'email', title: '서류 제출 요청',
    description: '명단의 이름과 제출 서류, 기한으로 안내 메일을 만들어요.',
    subjectTemplate: '{{name}}님, {{document}} 제출 안내',
    bodyTemplate: '{{name}}님, 안녕하세요.\n\n{{document}}를 {{dueDate}}까지 제출해 주세요.\n감사합니다.',
    columns: { email: '이메일', name: '이름', document: '서류', dueDate: '기한' } };
}

/** Ephemeral question cards never enter the chat transcript or activity draft. */
export interface AutomationQuestion {
  id: string;
  kind: 'text' | 'choice' | 'connect' | 'sheet' | 'preview' | 'preview_review' | 'publish' | 'unpublish' | 'install' | 'script';
  title: string;
  description?: string;
  choices?: Array<{ id: string; label: string }>;
  allowFreeText?: boolean;
  preview?: AutomationPreview;
  recipe?: AutomationRecipe;
  script?: { action: 'upload' | 'deploy' | 'setup'; digest: string; files: Array<{ name: string; source: string }>; scopes: string[] };
  private: boolean;
  error?: string;
}
export interface AutomationAnswer {
  questionId: string;
  text?: string;
  choiceId?: string;
  approved?: boolean;
  cancelled?: boolean;
}
/** Repeated, stale, fabricated, and multi-selection answers are rejected by the host. */
export function validateAutomationAnswer(question: AutomationQuestion, value: AutomationAnswer): boolean {
  if (!value || value.questionId !== question.id) return false;
  if (value.cancelled === true) return true;
  if (['connect', 'preview', 'preview_review', 'publish', 'unpublish', 'install', 'script'].includes(question.kind)) return value.approved === true && value.text === undefined && value.choiceId === undefined;
  if (question.kind === 'sheet' || question.kind === 'text') return typeof value.text === 'string' && !!value.text.trim() && value.text.length <= (question.kind === 'sheet' ? 4096 : 2000) && value.choiceId === undefined;
  const choice = typeof value.choiceId === 'string' && !!question.choices?.some(item => item.id === value.choiceId);
  const free = question.allowFreeText === true && typeof value.text === 'string' && !!value.text.trim() && value.text.length <= 2000;
  return (choice && value.text === undefined) || (free && value.choiceId === undefined);
}
