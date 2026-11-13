# 초대 좌석: 초대받은 사람이 Studio를 쓰는 방식 · 2026-11-13

> 작성일 2026-11-13 · 상태: 초안(검토 대기) · 결정: Lab `docs/decisions/2026-11-12-studio-invite-only.md` · 근거: hypeproof/hypeproof-service#394, hypeproof/hypeproof-service#403 · 검증: [#3849](https://github.com/hypeproof/hypeproof-studio/issues/3849) · 검토: TJ-kr

## 문제

2026-11-12부터 Studio는 초대로만 들어온다. 초대받은 사람은 HypeProof가 AI 원가를 내는 좌석을 받는다. 이 좌석은
앱 새 버전 없이 동작한다. Service가 초대 권한을 이미 출시된 앱이 켜는 `super` 이용권으로 보내기 때문이다.
그런데 Studio 요구사항 문서에는 이 좌석을 설명하는 행이 없다. 개인 경로는 아직 무료 시작, 하루 다시 채움,
이용권 구매로 적혀 있다(`studio-native-trial-ux.md`, `unified-studio-experience.md`, `access-budget-settlement.md`.
이 세 문서는 다른 PR이 고친다). 앱이나 Service가 이 좌석을 바꿀 때 기준으로 삼을 행이 필요하다.

이 문서는 새 동작을 만들지 않는다. 이미 출시된 앱과 Service가 하는 일을 한 행으로 적는다.

## 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| INV-01 | 초대받은 계정은 Google 로그인 뒤 `/v1/me/passes`에서 id `super`인 이용권 하나(`grant: "invite"`, 이름 `초대 이용권`)를 받고, 앱은 그것을 다른 `super` 이용권과 똑같이 켠다(`POST /v1/me/passes/super/activate`). 한도는 KST 달력 기준 한 달 US$10이고 하루 한도는 없다. 한도에 닿으면 그 사람만 다음 달 1일 00:00 KST까지 멈추고, 앱은 Service 문장을 그대로 보여 주며 금액·남은 금액·구매 안내를 보이지 않는다. super 계정은 초대가 있어도 자기 super 이용권을 쓴다(super가 이긴다). 이용권 화면의 “무제한” 문구는 지금 그대로 둔다(Jay 2026-11-13). 초대받은 사람은 기본 3명을 다시 초대할 수 있다 | P0 |

## 계약 (지금의 Service 동작)

| 항목 | 동작 | 근거 |
|---|---|---|
| 이용권으로 도착 | 초대 권한이 있고 super 권한이 없는 계정의 `/v1/me/passes` 맨 앞에 `{id: "super", product_name: "초대 이용권", grant: "invite", unlimited: false, status: "active" \| "exhausted", monthly_ceiling: {currency, amount_micro, spent_micro, resets_at}}`이 온다. 요청 수 필드는 실제 한도가 아니다 | Service `worker/src/lib/invites.ts` `invitePassFor`, #394 |
| 켜기 | 앱은 Google 로그인 뒤 `super` 이용권을 켠다. Service의 `activateAccountGrant`가 super 행이 있으면 super 좌석을, 없고 초대 권한이 있으면 이번 달 초대 좌석을 준다. v2026.1105.0 이후 앱이면 새 앱 버전이 필요 없다 | `activateAccountGrant`, #394 |
| 달마다 좌석 | KST 달마다 좌석 하나(`native_trials`, owner `account-invite`, purpose `pass`). 좌석은 다음 달 1일 00:00 KST에 끝나고, 비용 상한은 그달 US$10에서 이미 쓴 만큼 뺀 값이다 | `activateInvite`, migration 0050 |
| 하루 한도 없음 | 초대 좌석에는 하루 한도도, 하루 다시 채움도 없다. 무료 시작의 하루 다시 채움(`refills_at`, REQ-STUDIO-FREE-DAILY-REFILL)은 이 좌석에 해당하지 않는다 | 결정 §1 |
| 한도에서 멈춤 | 정산된 비용이 상한을 넘을 다음 요청을 Service가 429 `trial_cost_exhausted`로 거절한다. 문장은 `이번 달 이용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다. 만든 파일과 대화는 그대로 남아 있습니다.`이고 `refills_at`은 다음 달 시작이다. 그 사람만 멈춘다. 운영 알림은 한 사람당 한 달에 한 번, 계정 id만 쓴다 | `native-trial-budget.ts`, `INVITE_CEILING_MESSAGE`, #403 |
| 금액을 보이지 않음 | 고객 화면에는 금액도 다시 채우는 날짜도 쓰지 않는다. 앱은 `monthly_ceiling`의 금액 필드를 그리지 않는다. 운영자 화면만 실제 상한과 사용액을 본다 | 결정 “no codes and no amounts”, #403 |
| super가 이긴다 | Lab 멤버·운영자가 부여한 super 계정은 초대가 있어도 super 이용권(하루 US$30)을 쓴다. super 계정은 초대를 받을 수 없다(`redeem` 거절) | `activateAccountGrant`, #394 |
| “무제한” 문구 유지 | 시작 화면 이용권 카드는 id가 `super`이면 `관리자가 부여한 무제한 이용 권한`과 `무제한으로 시작하기`를 보인다. 초대 좌석은 실제로는 월 한도가 있지만 이 문구를 바꾸지 않는다(Jay 2026-11-13 결정). 문구를 바꾸려면 새 결정이 먼저다 | `webview-ui/src/AccountEntry.tsx` |
| 다시 초대 | 초대받은 사람은 기본 3명을 초대한다. 운영자가 사람마다 바꿀 수 있다(0–100). super 계정과 운영자는 제한이 없다. 초대는 한 번만 쓰이고, 쓰지 않으면 14일 뒤 끝난다. 초대 발급 화면은 Lab(`/studio/invite`)에 있고 Studio 앱에는 없다 | `INVITE_DEFAULT_ALLOWANCE`, `issueInvite`, #394, #403 |
| 나이 | 계정 가입은 지금처럼 만 14세 이상이다. 만 14세 미만은 이 좌석으로 들어오지 않는다(보호자 계정 요구사항은 별도 문서) | 결정 §Age, `upsertAccount` |

## 앱이 지킬 것

- 초대 좌석의 한도 거절은 이용권 좌석의 거절이다. 무료 체험 끝 카드(구매 안내, 이용권 살펴보기)를 띄우지 않는다.
  Service 문장을 그대로 보여 준다.
- 앱 어디에도 초대 좌석의 금액, 남은 금액, 다시 채우는 날짜를 쓰지 않는다.
- 초대 좌석 때문에 앱이 새로 묻는 것은 없다. 초대 코드를 앱에서 입력받지 않는다. 같은 Google 계정으로 로그인하면 된다.

## 검증

- Service: `worker/test/invites.test.mjs`, `worker/test/super-access.test.mjs`, `worker/test/account-reflection.test.mjs`
  (hypeproof-service 안에 있고, Service #394·#403 본문이 통과로 보고했다).
  이 문서는 그 결과를 다시 주장하지 않는다.
- App 행별 대조(실행 단위 `invite-seat-acceptance`): 초대받은 계정으로 출시된 앱에 로그인해 이용권 카드와 시작,
  한도에 닿은 계정의 거절 문장, super와 초대를 함께 가진 계정을 확인한다. 합성 Service와 실제 운영 계정 결과를 나눠 적는다.

## 범위 밖

- 이용권 카드의 “무제한” 문구 변경(결정으로 보류).
- 모바일 앱의 초대 링크와 한 번에 로그인(결정의 “Not in this decision”).
- 무료 시작·하루 다시 채움·이용권 구매 문서의 정리(다른 PR).
