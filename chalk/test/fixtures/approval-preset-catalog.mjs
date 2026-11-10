// CGP-AGENT-R-019 — the Service-owned approval preset catalog, verbatim, strictest first.
// Source of truth: hypeproof-service worker/src/lib/lesson-approval-preset.ts (APPROVAL_PRESETS).
// Chalk and Studio render the strings the Service serves; tests that stand in for the Service import this one
// copy so there is a single place to update when the Service catalog changes (chalk/test/approval-preset-drift.test.mjs
// checks every other copy in Studio against it, and against the sibling Service checkout when one is present).
export const SERVICE_APPROVAL_PRESETS = Object.freeze([
  { id: 'always_ask', label: '항상 묻기', description: '파일을 고치거나 명령을 실행하기 전에 매번 묻고, 한 번 허락한 일도 다시 물어봐요.' },
  { id: 'before_changes', label: '바꾸기 전에 묻기', description: '파일을 고치거나 명령을 실행하기 전에 물어봐요.' },
  { id: 'important_only', label: '중요한 것만 묻기', description: '되돌리기 어려운 명령, 브라우저 열기, 보조 AI 맡기기처럼 중요한 일만 물어봐요.' },
]);
