// Trial diagnosis 2026-10-18 D3 (ind-trial-vocabulary) — seat-aware wording.
// Solo seats (trial, bought pass, personal work) must not be told to call 스태프 / 강사 /
// 운영 담당자 or Jay; classroom seats keep their copy byte for byte.
//   positive — classroom (and unknown kind) still produce the exact old sentences
//   negative — every solo variant contains none of the classroom-only words
// Run: node --experimental-strip-types test/seat-vocabulary.smoke.mjs

import assert from "node:assert/strict";

const v = await import("../src/seatVocabulary.ts");
const id = await import("../src/coachIdentity.ts");
const { proxyChat, ProxyTransportError } = await import("../src/proxyClient.ts");

const BANNED = /스태프|강사|운영 담당자|Jay/;

// ─── audience resolution ───────────────────────────────────────────────────────
{
  assert.equal(v.seatAudience({ kind: "trial" }), "solo");
  assert.equal(v.seatAudience({ kind: "personal" }), "solo");
  assert.equal(v.seatAudience({ kind: "classroom", pass: { ends_at: 1 } }), "solo", "a pass is solo whatever the kind");
  assert.equal(v.seatAudience({ kind: "classroom" }), "classroom");
  assert.equal(v.seatAudience({}), "classroom", "unknown kind keeps classroom copy");
  assert.equal(v.seatAudience(null), "classroom");
  assert.equal(v.seatAudience(undefined), "classroom");
  assert.equal(v.profileAudience({ activity_kind: "trial" }), "solo");
  assert.equal(v.profileAudience({ activity_kind: "classroom" }), "classroom");
  assert.equal(v.profileAudience({ pass: { ends_at: 1 } }), "solo");
  assert.equal(v.profileAudience(null), "classroom");
}

// ─── classroom copy is unchanged (positive control) ────────────────────────────
{
  assert.equal(v.transportFailureText("classroom"), "문제가 발생했습니다. 다시 시도하거나 운영 담당자에게 문의해 주세요.");
  assert.equal(
    v.rateLimitStallText("classroom"),
    "요청 한도에 도달해 응답을 받지 못했습니다. 잠시 후 다시 시도하거나 강사에게 체험 한도를 확인해 주세요. (429)",
  );
  assert.equal(v.errorIdTitle("classroom"), "강사에게 이 ID를 알려주세요 — Jay가 바로 추적할 수 있어요");
  assert.equal(v.reportButtonTitle("classroom"), "이 문제를 Jay에게 신고합니다 (request_id 등 메타데이터 자동 첨부) — #64");
  assert.equal(v.reportContactPrompt("classroom"), "Jay가 회신할 수 있는 연락처 (디스코드 ID, 이메일 등). 비워둬도 OK.");
  assert.equal(v.reportReceipt("classroom", "r1"), "신고 접수됐어요. ID: r1\nJay가 #hypeproof-studio 채널에서 확인하는 대로 회신드릴게요.");
  assert.equal(
    id.coachDegradedNotice("코치"),
    "지금 코치는 파일 저장·명령 실행 도구 없이 돌고 있어요 — 만들기와 미리보기는 그대로 되지만, 저장소·배포는 이 상태에서 안 돼요. 스태프를 불러주세요.",
    "default audience is classroom",
  );
  assert.equal(id.coachDegradedNotice("코치", "classroom"), id.coachDegradedNotice("코치"));
}

// ─── solo copy carries no classroom-only word (negative control) ───────────────
{
  const solo = [
    v.transportFailureText("solo"),
    v.rateLimitStallText("solo"),
    v.degradedRemedy("solo"),
    v.errorIdTitle("solo"),
    v.reportButtonTitle("solo"),
    v.reportContactPrompt("solo"),
    v.reportContactPlaceholder("solo"),
    v.reportReceipt("solo", "r1"),
    id.coachDegradedNotice("코치", "solo"),
    id.coachDegradedNotice("별똥별", "solo"),
  ];
  for (const s of solo) assert.doesNotMatch(s, BANNED, `solo copy leaks classroom vocabulary: ${s}`);
  // The meter itself must be able to fail: every classroom variant does contain one.
  for (const a of ["classroom"]) {
    for (const s of [v.transportFailureText(a), v.rateLimitStallText(a), v.degradedRemedy(a), v.errorIdTitle(a), v.reportButtonTitle(a), v.reportContactPrompt(a), v.reportReceipt(a, "r")]) {
      assert.match(s, BANNED, `classroom control should contain a classroom word: ${s}`);
    }
  }
  // Solo copy still says what happened and where to go.
  assert.match(v.transportFailureText("solo"), /문제가 발생했습니다/);
  assert.match(v.transportFailureText("solo"), /문제 신고하기/);
  assert.match(v.rateLimitStallText("solo"), /\(429\)$/);
  assert.match(id.coachDegradedNotice("코치", "solo"), /^지금 코치는 파일 저장·명령 실행 도구 없이/);
  assert.match(v.reportReceipt("solo", "abc"), /ID: abc/);
}

// ─── proxyChat generic failure card follows the seat ───────────────────────────
{
  const realFetch = globalThis.fetch;
  const run = async (audience) => {
    globalThis.fetch = async () => new Response("", { status: 500, headers: { "x-request-id": "rid-1" } });
    try {
      await proxyChat({
        proxyUrl: "http://x/v1", model: "m", token: "t", history: [], userText: "hi",
        signal: new AbortController().signal, onDelta() {},
        ...(audience ? { audience } : {}),
      });
      assert.fail("expected a transport error");
    } catch (e) {
      assert.ok(e instanceof ProxyTransportError, String(e));
      return e.message;
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  assert.equal(await run(undefined), v.TRANSPORT_FAILURE_CLASSROOM, "no audience → old copy");
  assert.equal(await run("classroom"), v.TRANSPORT_FAILURE_CLASSROOM);
  const solo = await run("solo");
  assert.equal(solo, v.TRANSPORT_FAILURE_SOLO);
  assert.doesNotMatch(solo, BANNED);
}

console.log("seat-vocabulary.smoke.mjs — all assertions passed");
