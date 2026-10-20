import { expect, type FrameLocator, type Locator } from '@playwright/test';

// Code entry on the start page, whichever way the Service draws it (TUX-SP-14).
// While the Service advertises free start, the start page shows the free card and a code
// holder enters through "참여 코드가 있어요" (label "참여 코드"). Otherwise the peer choices
// "AI 체험하기" / "수업에 참여하기" lead to the code form. The trial offer is read
// asynchronously, so the label can change after the choice; the input is addressed by id.
type Start = FrameLocator | Locator;

/** Opens the code form for `kind` and returns its input. Reports which path it took. */
export async function openCodeEntry(start: Start, kind: 'trial' | 'classroom'): Promise<{ input: Locator; free: boolean }> {
  const code = start.getByRole('button', { name: '참여 코드가 있어요', exact: true });
  const choice = start.getByRole('button', { name: kind === 'trial' ? 'AI 체험하기' : '수업에 참여하기', exact: true });
  await expect(code.or(choice).first()).toBeVisible({ timeout: 30000 });
  const free = await code.isVisible();
  await (free ? code : choice).click();
  const input = start.locator('#course-code');
  await expect(input).toBeVisible();
  return { input, free };
}
