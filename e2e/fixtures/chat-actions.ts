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

export async function chooseChatModel(chat: Chat, alias: string) {
  if (!(await menuToggle(chat).count())) {
    await chat.getByRole('combobox', { name: '대화 모델' }).selectOption(alias);
    return;
  }
  await chatMenuAction(chat, '설정');
  const dialog = chat.getByRole('dialog', { name: '대화 설정', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByText('응답 고급 설정', { exact: true }).click();
  await dialog.getByRole('combobox', { name: '대화 모델' }).selectOption(alias);
  await chat.getByRole('button', { name: '대화 설정 닫기', exact: true }).click();
  await expect(dialog).toBeHidden();
}
