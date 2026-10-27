/** Synthetic route walkthrough, not a connected mobile app or execution adapter. */
import { planCompanionRoute, COMPANION_CAPABILITIES } from '../extensions/hypeproof-chat/src/companionRouting.ts';

const context = { workspaceId: 'synthetic-workspace', projectId: 'synthetic-quiz',
  version: 1, access: 'active', host: 'online', allowedCapabilities: [...COMPANION_CAPABILITIES] };
const cases = [
  ['처음 연결하기', 'create_web', null],
  ['휴대폰에서 초안 작성', 'edit_draft', { ...context, host: 'offline' }],
  ['컴퓨터가 웹 작품 만들기', 'create_web', context],
  ['컴퓨터가 꺼진 동안 빌드 요청', 'build_web', { ...context, host: 'offline' }],
  ['큰 작업을 컴퓨터에서 이어하기', 'edit_desktop', context],
  ['회수된 기기의 요청', 'build_web', { ...context, access: 'revoked' }],
];
console.log('SYNTHETIC ROUTING ONLY — no connection, file operation, AI call or build is performed.');
for (const [scenario, capability, scope] of cases) {
  const result = planCompanionRoute({ request: { workspaceId: context.workspaceId,
    projectId: context.projectId, version: 1, capability }, context: scope });
  console.log(JSON.stringify({ scenario, ...result }));
}
