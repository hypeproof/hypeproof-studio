// REQ-F6 — 조기 return 이 훅들 사이에 끼면 안 된다.
//
// 왜 이 TC 가 있나
//   2026-08-10 실기기 세션에서 코치 작명 의식 도중 채팅 패널이 두 번 크래시했다
//   (React #300 · #310). 원인은 `ChatPanel` 의 작명 카드 조기 return 이 훅 3개
//   **위**에 있던 것:
//
//     작명 전 (needsNaming=true)  → return → 훅 N개
//     아이가 이름 저장 → coach.configured=true
//     작명 후 (needsNaming=false) → 통과   → 훅 N+3개   ← "Rendered more hooks"
//
//   작명 의식은 모든 학생이 반드시 통과하므로 정상 경로에서 100% 재현된다.
//   런타임 크래시라 타입체크·기존 스모크가 전부 초록인 채로 지나갔다.
//
// 이 TC 는 소스를 정적으로 읽어 컴포넌트별 "첫 조기 return 이후의 훅"을 센다.
// 앱을 띄우지 않으므로 밀리초에 끝나고 매 PR 마다 돈다.
//
// 대조군을 둘 다 둔다 (rules/verification.md §2):
//   음성 — 위반 사본은 반드시 잡혀야 한다. 통과하면 계측기가 고장난 것
//   양성 — 올바른 사본은 통과해야 한다. 너무 엄격하지 않은지

import { readFileSync } from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const TARGET = join(here, "..", "webview-ui", "src", "ChatPanel.tsx");

const HOOK = /^use(State|Effect|Memo|Callback|Ref|Reducer|LayoutEffect|Context)$/;

/** Return and hook positions in the component's own lexical function only. */
export function findHooksAfterEarlyReturn(source) {
  const file = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations = [];
  const visit = (component) => {
    if (ts.isFunctionDeclaration(component) && component.name && /^[A-Z]/.test(component.name.text) && component.body) {
      const returns = [], hooks = [];
      const inspect = (node) => {
        // A callback's return exits that callback, never the enclosing component render.
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node)) returns.push(node.getStart(file));
        if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))) {
          const name = ts.isIdentifier(node.expression) ? node.expression.text : node.expression.name.text;
          if (HOOK.test(name)) hooks.push(node.getStart(file));
        }
        ts.forEachChild(node, inspect);
      };
      inspect(component.body);
      const first = Math.min(...returns);
      const late = hooks.filter(position => position > first);
      const line = position => file.getLineAndCharacterOfPosition(position).line + 1;
      if (late.length) violations.push({ component: component.name.text, firstReturn: line(first), hooks: late.map(line) });
    }
    ts.forEachChild(component, visit);
  };
  visit(file);
  return violations;
}

let failed = 0;
const ok = (msg) => console.log(`  ok   ${msg}`);
const bad = (msg) => {
  console.log(`  FAIL ${msg}`);
  failed++;
};

console.log("=== 1. 하네스 검증 (계측기가 진짜로 잡는가) ===");

const NEGATIVE = `
function Broken(props) {
  const [a, setA] = useState(0);
  if (!props.ready) {
    return null;
  }
  const [b, setB] = useState(1);
  return <div />;
}
`;
const negFound = findHooksAfterEarlyReturn(NEGATIVE);
negFound.length === 1 && negFound[0].component === "Broken"
  ? ok("음성 대조군: 훅 사이의 조기 return 을 잡는다 (기대대로)")
  : bad(`음성 대조군이 안 잡혔다 — 계측기 고장: ${JSON.stringify(negFound)}`);

const POSITIVE = `
function Fine(props) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(1);
  if (!props.ready) {
    return null;
  }
  return <div />;
}
`;
findHooksAfterEarlyReturn(POSITIVE).length === 0
  ? ok("양성 대조군: 훅 아래의 조기 return 은 통과한다 (너무 엄격하지 않다)")
  : bad("양성 대조군이 잘못 잡혔다 — 계측기가 과하게 엄격하다");

const NESTED = `
function WithCallbacks(props) {
  const submitVoice = () => { if (!props.ready) return null; return props.send(); };
  function nested() { return <span />; }
  const [value] = useState(0);
  useEffect(() => { if (!value) return; return () => {}; }, [value]);
  return <div onClick={submitVoice} />;
}`;
findHooksAfterEarlyReturn(NESTED).length === 0
  ? ok("nested arrow/function callback returns do not exit the component")
  : bad("nested callback return was mistaken for a component return");
const planted = NESTED.replace('const [value]', 'if (!props.ready) return null; const [value]');
findHooksAfterEarlyReturn(planted).length === 1
  ? ok("negative control: a real early component return beside callbacks is rejected")
  : bad("nested callbacks concealed a real component early return");

console.log("");
console.log("=== 2. 실제 ChatPanel.tsx (REQ-F6) ===");

const violations = findHooksAfterEarlyReturn(readFileSync(TARGET, "utf8"));
if (violations.length === 0) {
  ok("ChatPanel.tsx: 조기 return 이후의 훅 없음");
} else {
  for (const v of violations) {
    bad(`${v.component}() — ${v.firstReturn}행 조기 return 이후 훅: ${v.hooks.join(", ")}행`);
  }
  console.log("");
  console.log("  조기 return 을 모든 훅 아래로 내려라. 훅은 렌더마다 같은 개수로 실행되어야 한다.");
}

console.log("");
if (failed) {
  console.log(`FAIL — ${failed}건`);
  process.exit(1);
}
console.log("PASS — REQ-F6 훅 순서 정상");
