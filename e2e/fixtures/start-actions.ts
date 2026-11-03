import { expect, type FrameLocator, type Locator } from '@playwright/test';

// Code entry on the start page, whichever way the Service draws it (TUX-SP-14).
// While the Service advertises free start, the start page shows the free card and a code
// holder enters through "참여 코드가 있어요" (label "참여 코드"). Otherwise the peer choices
// "AI 체험하기" / "수업에 참여하기" lead to the code form. An older App may show the form
// already.
//
// The trial offer is read asynchronously after the page first renders. The peer choices can
// be drawn and then replaced by the free card at any moment, so a single "look, then click"
// races (v2026.1020.2-rc.1 acceptance run 39379937514: the chosen button was detached).
// This loops until the form is open: whichever entry is on screen is clicked with a short
// timeout, and a detached or replaced button is simply looked up again. Once the form is
// open it stays open when the offer arrives. The input is addressed by id because its label
// differs by path.
type Start = FrameLocator | Locator;

/** Opens the code form for `kind` and returns its input and whether the free card led there. */
export async function openCodeEntry(start: Start, kind: 'trial' | 'classroom', timeout = 45000): Promise<{ input: Locator; free: boolean }> {
  const code = start.getByRole('button', { name: '참여 코드가 있어요', exact: true });
  const choice = start.getByRole('button', { name: kind === 'trial' ? 'AI 체험하기' : '수업에 참여하기', exact: true });
  const input = start.locator('#course-code');
  const label = start.locator('label[for="course-code"]');
  const end = Date.now() + timeout;
  let free = false;
  while (!(await input.isVisible().catch(() => false))) {
    if (Date.now() > end) throw new Error(`code form did not open within ${timeout} ms (kind ${kind})`);
    for (const [target, isFree] of [[code, true], [choice, false]] as const) {
      if (await target.isVisible().catch(() => false)) {
        if (await target.click({ timeout: 2000 }).then(() => true, () => false)) free = isFree;
        break;
      }
    }
    await input.waitFor({ state: 'visible', timeout: 500 }).catch(() => {});
  }
  // The label is the ground truth: "참여 코드" is drawn only while free start is advertised.
  if ((await label.textContent().catch(() => null))?.trim() === '참여 코드') free = true;
  await expect(input).toBeEnabled();
  return { input, free };
}
