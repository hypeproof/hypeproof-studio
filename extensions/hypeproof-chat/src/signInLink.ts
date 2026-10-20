/**
 * REQ-L13 ⑧ (CGP-SHELL-R-022) — 링크 복사 on the sign-in screen, for opening the device approval
 * page in another browser or on another device. Pure: no VS Code API, no network, no storage.
 *
 * What may be copied: the verification URL the flow already opens, and only when the one thing it
 * carries is the user code already on screen. The device code, access and refresh tokens never
 * reach the clipboard: any other query parameter, a fragment, userinfo, another origin or path,
 * or a value equal to a known secret makes the link uncopyable (no button rather than a risk).
 */
export type SignInLinkState = 'ready' | 'copied' | 'failed';

export const SIGN_IN_LINK_COPY = {
  label: '링크 복사',
  hint: '브라우저가 안 열렸거나 다른 브라우저·기기에서 열고 싶을 때 써요.',
  copied: '링크를 복사했어요. 다른 브라우저나 기기의 주소창에 붙여 넣어 열어 주세요.',
  failed: '링크를 복사하지 못했어요. 아래 주소를 직접 입력해 열어 주세요.',
} as const;

export function copyableSignInLink(url: string, site: string, userCode: string, secrets: readonly string[]): string | undefined {
  try {
    const u = new URL(url), configured = new URL(site);
    if (u.origin !== configured.origin || u.pathname !== '/studio/connect' || u.username || u.password || u.hash) return;
    const keys = [...u.searchParams.keys()];
    if (keys.length > 1 || keys.some(k => k !== 'code')) return;
    const code = u.searchParams.get('code');
    if (code !== null && code !== userCode) return;
    if (secrets.some(secret => secret && url.includes(secret))) return;
    return url;
  } catch { return; }
}

/** Writes the link and reports the outcome; a refused clipboard is a failure, never a copy. */
export async function copySignInLink(link: string | undefined, write: (text: string) => PromiseLike<void>): Promise<SignInLinkState | undefined> {
  if (!link) return;
  try { await write(link); return 'copied'; } catch { return 'failed'; }
}
