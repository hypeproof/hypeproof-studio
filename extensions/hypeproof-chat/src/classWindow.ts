// CGP-SHELL-R-025: presentation only. The Service remains the admission authority.
export interface ClassWindow { id: string; startsAt: number; endsAt: number; noticeId?: string }
export interface ClassConnection {
  class_run_id: string;
  student?: { u: string; c: string; p: string };
  run?: { starts_at: number; ends_at: number };
}
/** A connected class is not necessarily the current chat seat. Never borrow another seat's time. */
export function currentClassWindow(connection: ClassConnection | null, identity: Record<string, unknown> | undefined, classroom: boolean): ClassWindow | null {
  const s = connection?.student, run = connection?.run;
  if (!classroom || !s || !identity || !run || !connection?.class_run_id ||
      !['u', 'c', 'p'].every(k => typeof identity[k] === 'string' && identity[k] === s[k as keyof typeof s]) ||
      !Number.isSafeInteger(run.starts_at) || !Number.isSafeInteger(run.ends_at) ||
      run.starts_at <= 0 || run.ends_at <= run.starts_at || run.ends_at > 8640000000000000) return null;
  return { id: connection.class_run_id, startsAt: run.starts_at, endsAt: run.ends_at };
}
/** Unknown or elapsed windows produce no claim about server admission. */
export function classWindowNotice(window: ClassWindow | null | undefined, now: number): string | null {
  if (!window || !Number.isFinite(now) || !Number.isSafeInteger(window.startsAt) || !Number.isSafeInteger(window.endsAt) ||
      window.startsAt <= 0 || window.endsAt <= window.startsAt || now < window.startsAt || now >= window.endsAt) return null;
  const remaining = window.endsAt - now;
  if (remaining > 600000) return null;
  return `수업이 ${Math.ceil(remaining / 60000)}분 뒤에 끝나요`;
}
