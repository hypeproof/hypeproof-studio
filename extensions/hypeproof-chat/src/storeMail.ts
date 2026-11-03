// A store mail skill's run on the buyer's device (Epic #3418 custody design v1 D10, F7). No `vscode` import:
// automationHost.ts supplies the buyer's Google runtime, roster setting and the approval modal.
//
// The template never reaches this device: only the buyer's roster rows go to the Service, which renders the
// messages. Every recipient must be the address of its own row in the buyer's own sheet, the buyer approves the
// exact preview, and the mail leaves through the buyer's own Gmail connection. No model takes part.
import type { EmailPreview, SendRecord } from './googleAutomation.ts';

export interface StoreMailRow { to: string; values: Record<string, string> }
export interface StoreMailMessage { to: string; subject: string; body: string }
export interface StoreMailDeps {
  runtime: {
    getConnectionIdentity(): Promise<string | null>;
    readSheet(args: { spreadsheetId: string; range: string }): Promise<string[][]>;
    previewRendered(args: { emailColumn: string; messages: readonly StoreMailMessage[] }): Promise<EmailPreview>;
    send(args: { previewId: string; approved: boolean }): Promise<{ records: SendRecord[] }>;
  };
  /** The roster sheet the buyer set up in this activity, or null. */
  sheet(): Promise<{ spreadsheetId: string; range: string; connection: string } | null>;
  maxRecipients: number;
  /** The exact-preview approval; true only when the buyer approved this preview. */
  confirm(preview: EmailPreview): Promise<boolean>;
  /** Re-checks the activity after the approval; false stops before any send. */
  stillAllowed(): Promise<boolean>;
}

export const STORE_MAIL_APPROVE = '확인한 메일 보내기';
/**
 * The host's side of a run, built from the host's own primitives so its gates are tested here: the modal answer is
 * the approval, the activity is checked again after it, and the cap is the activity's recipient cap.
 */
export function storeMailHostDeps(host: {
  runtime: StoreMailDeps['runtime'];
  maxRecipients: number;
  title: string;
  sheet: StoreMailDeps['sheet'];
  showModal(message: string, detail: string, approve: string): PromiseLike<string | undefined>;
  reauthorize(): Promise<boolean>;
}): StoreMailDeps {
  return {
    runtime: host.runtime,
    maxRecipients: host.maxRecipients,
    sheet: host.sheet,
    confirm: async (preview) => {
      const detail = preview.messages.map((m, i) => `${i + 1}. 받는 사람: ${m.to}\n제목: ${m.subject}\n\n${m.body}`).join('\n\n────────────────────\n\n');
      return (await host.showModal(`「${host.title}」로 ${preview.messages.length}명에게 보낼 메일을 모두 확인해 주세요.`, detail, STORE_MAIL_APPROVE)) === STORE_MAIL_APPROVE;
    },
    stillAllowed: () => host.reauthorize(),
  };
}

export async function runStoreMail(
  deps: StoreMailDeps,
  skill: { title: string; params: { name: string; label: string }[] },
  render: (rows: StoreMailRow[]) => Promise<StoreMailMessage[]>,
): Promise<{ sent: number; failed: number } | { cancelled: true }> {
  const identity = await deps.runtime.getConnectionIdentity();
  if (!identity) throw new Error('먼저 Google 계정을 연결해 주세요.');
  const setting = await deps.sheet();
  // A sheet set up under another Google account is not this buyer's roster now.
  if (!setting || setting.connection !== identity) throw new Error('먼저 내 명단 시트를 연결해 주세요.');
  const sheet = await deps.runtime.readSheet({ spreadsheetId: setting.spreadsheetId, range: setting.range });
  const headers = (sheet[0] ?? []).map((cell) => cell.trim());
  const column = (label: string) => {
    const at = headers.indexOf(label.trim());
    if (at < 0 || headers.lastIndexOf(label.trim()) !== at) throw new Error(`시트의 ${label} 열을 하나만 준비해 주세요.`);
    return at;
  };
  const email = skill.params.find((p) => p.name === 'email');
  if (!email) throw new Error('이 스킬에는 받는 사람 열 정보가 없어요.');
  const toAt = column(email.label);
  const fields = skill.params.filter((p) => p.name !== 'email').map((p) => [p.name, column(p.label)] as const);
  const rows = sheet.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => ({
    to: (row[toAt] ?? '').trim(),
    values: Object.fromEntries(fields.map(([name, at]) => [name, (row[at] ?? '').trim().slice(0, 200)])),
  }));
  if (!rows.length) throw new Error('보낼 수신자가 없어요.');
  if (rows.length > deps.maxRecipients) throw new Error(`한 번에 ${deps.maxRecipients}명까지 보낼 수 있어요.`);
  const rendered = await render(rows);
  // One message per row, in order, each to that row's own address; anything else is refused before a preview exists.
  if (!Array.isArray(rendered) || rendered.length !== rows.length || rendered.some((m, i) => m?.to?.trim().toLowerCase() !== rows[i]!.to.toLowerCase())) {
    throw new Error('받는 사람이 내 명단과 달라요. 보내지 않았어요.');
  }
  const preview = await deps.runtime.previewRendered({ emailColumn: email.label, messages: rendered });
  if (!(await deps.confirm(preview))) return { cancelled: true };
  if (!(await deps.stillAllowed())) throw new Error('활동이 변경돼 보내지 않았어요.');
  const { records } = await deps.runtime.send({ previewId: preview.id, approved: true });
  return { sent: records.filter((r) => r.status === 'sent').length, failed: records.filter((r) => r.status !== 'sent').length };
}
