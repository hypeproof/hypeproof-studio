import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { PersonalSpace } from '../webview-ui/src/PersonalSpace';
import type { PersonalSpaceView } from '../src/personalSpace';

const act = React.act;
const messages: any[] = [];
const post = (message: any) => messages.push(message);
const container = mountPoint();
const root = createRoot(container);
const render = async (space: PersonalSpaceView) => { await act(async () => root.render(<PersonalSpace accountId="alice" space={space} post={post} />)); };
const buttons = () => container.findAll((e: any) => e.localName === 'button');
const press = async (text: string) => { const button = buttons().find((e: any) => e.textContent === text); assert.ok(button, text); await act(async () => click(button)); };

async function main() {
await render({ opened: false, projects: [] });
assert.match(container.textContent, /대화와 파일은 동기화되지/);
await press('내 개인 공간 보기');
assert.deepEqual(messages.pop(), { type: 'personalSpaceOpen', accountId: 'alice' });
await render({ opened: true, loaded: true, projects: [] });
await press('개인 공간 만들기');
assert.deepEqual(messages.pop(), { type: 'personalSpaceEnsure', accountId: 'alice' });
const workspace = { id: 'w1', owner_account_id: 'alice', name: '개인 공간', kind: 'personal' as const, created_at: 1 };
const project = { id: 'p1', workspace_id: 'w1', title: '<script>비밀 이름</script>', revision: 1, created_at: 1, updated_at: 1 };
await render({ opened: true, loaded: true, workspace, projects: [project], pendingTitle: '저장하던 이름', failed: true, message: '인터넷 연결을 확인해 주세요.' });
assert.equal(container.findAll((e: any) => e.localName === 'input')[0].getAttribute('disabled'), '');
await press('이 이름 저장 다시 시도');
assert.deepEqual(messages.pop(), { type: 'personalProjectCreate', title: '저장하던 이름', accountId: 'alice' });
await press(project.title + '다시 열기');
assert.deepEqual(messages.pop(), { type: 'personalProjectOpen', projectId: 'p1', accountId: 'alice' });
await render({ opened: true, loaded: true, workspace, projects: [project], selected: project });
assert.match(container.textContent, /저장된 이름 기록을 열었어요/);
const html = renderToStaticMarkup(<PersonalSpace accountId="alice" space={{ opened: true, workspace, projects: [project], selected: project }} post={post} />);
assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
await render({ opened: true, projects: [], failed: true, authenticationRequired: true });
await press('로그인 상태 새로고침'); assert.deepEqual(messages.pop(), { type: 'accountRefresh' });
await render({ opened: true, loaded: true, workspace, projects: [], busy: true });
assert.ok(buttons().every((e: any) => e.hasAttribute('disabled')));
await act(async () => root.unmount());
console.log('PASS personal-space UI: explicit intents, scoped identity, stable retry, escaped titles, metadata detail, busy controls');

}
void main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
