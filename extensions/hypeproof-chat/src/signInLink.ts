/**
 * REQ-L13 ⑧ (CGP-SHELL-R-022) — 링크 복사 on the sign-in screen, for opening the device approval
 * page in another browser or on another device. Pure: no VS Code API, no network, no storage.
 *
 * What may be copied: the verification URL the flow already opens, and only when the one thing it
 * carries is the user code already on screen (required, REQ-L13 ⑧). The device code, access and refresh tokens never
 * reach the clipboard: any other query parameter, a fragment, userinfo, another origin or path,
 * or a value equal to a known secret makes the link uncopyable (no button rather than a risk).
 */
export type SignInLinkState = 'ready' | 'copied' | 'failed';

export const SIGN_IN_LINK_COPY = {
  label: '링크 복사',
  // Device-code phishing: whoever approves the link signs this Studio into *their* account, so the
  // link is for the learner's own browser or device only (REQ-L13 ⑧).
  hint: '내 다른 브라우저나 기기에서만 여세요. 이 링크를 다른 사람에게 보내지 마세요.',
  copied: '링크를 복사했어요. 다른 브라우저나 기기의 주소창에 붙여 넣어 열어 주세요.',
  failed: '링크를 복사하지 못했어요. 아래 주소를 직접 입력해 열어 주세요.',
} as const;

export function copyableSignInLink(url: string, site: string, userCode: string, secrets: readonly string[]): string | undefined {
  try {
    const u = new URL(url), configured = new URL(site);
    if (u.origin !== configured.origin || u.pathname !== '/studio/connect' || u.username || u.password || u.hash) return;
    const keys = [...u.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== 'code' || !userCode || u.searchParams.get('code') !== userCode) return;
    // Return the parsed form: the raw server string may carry whitespace or a backslash that
    // another device's linkifier splits or shows differently from what the browser opens.
    const href = u.href;
    if (secrets.some(secret => secret && (url.includes(secret) || href.includes(secret)))) return;
    return href;
  } catch { return; }
}

/** Writes the link and reports the outcome; a refused clipboard is a failure, never a copy. */
export async function copySignInLink(link: string | undefined, write: (text: string) => PromiseLike<void>): Promise<SignInLinkState | undefined> {
  if (!link) return;
  try { await write(link); return 'copied'; } catch { return 'failed'; }
}
