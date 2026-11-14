import { expect, type FrameLocator, type Locator } from '@playwright/test';

// Personal chat (#1760/#1763, REQ-STUDIO-CHAT-POLISH) keeps its secondary actions in the
// `대화 메뉴` and the model under 대화 설정 > 응답 고급 설정. A chat without that menu
// (classroom layout) keeps them inline. Call these after the chat has rendered.
type Chat = FrameLocator | Locator;

const menuToggle = (chat: Chat) => chat.getByRole('button', { name: '대화 메뉴', exact: true });

export async function chatMenuAction(chat: Chat, name: string) {
  if (await menuToggle(chat).count()) {
    await menuToggle(chat).click();
    await chat.getByRole('menuitem', { name, exact: true }).click();
  } else {
    await chat.getByRole('button', { name, exact: true }).click();
  }
}

// When the Service routes the model itself (service#297: one 자동 choice), the menu is disabled
// and there is nothing to pick; the turn runs on whatever the Service routes it to.
async function selectModel(select: Locator, alias: string) {
  await expect(select).toBeVisible();
  if (await select.isDisabled()) return;
  // The menu carries one entry per model: an alias and the explicit id it resolves to are the
  // same choice, and the Service keeps the first key it meets (`modelBinding`, [default, ...allowed]).
  // service#388 moved the trial profile's default to claude-haiku-5-5, so the hypeproof-fast
  // alias that resolved to the same model is no longer its own entry. A pinned alias can be
  // absent while the picker itself works: take the menu's first entry — the profile's default
  // model — and keep checking that the App picks a model and its turn writes the file.
  const options = await select.locator('option').evaluateAll(all => all.map(option => (option as HTMLOptionElement).value));
  await select.selectOption(options.includes(alias) ? alias : { index: 0 });
}

export async function chooseChatModel(chat: Chat, alias: string) {
  if (!(await menuToggle(chat).count())) {
    await selectModel(chat.getByRole('combobox', { name: '대화 모델' }), alias);
    return;
  }
  await chatMenuAction(chat, '설정');
  const dialog = chat.getByRole('dialog', { name: '대화 설정', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByText('응답 고급 설정', { exact: true }).click();
  await selectModel(dialog.getByRole('combobox', { name: '대화 모델' }), alias);
  await chat.getByRole('button', { name: '대화 설정 닫기', exact: true }).click();
  await expect(dialog).toBeHidden();
}
