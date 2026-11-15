import type { AccountView } from './accountSession';

/** Presentation only. Account names never establish membership or approval authority. */
export function accountGreeting(account: AccountView | undefined): string | null {
  if (account?.status !== 'signedIn') return null;
  const name = account.account?.display_name?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return name ? `안녕하세요, ${Array.from(name).slice(0, 80).join('')}님.` : '안녕하세요.';
}
