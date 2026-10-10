# Worker 분리 밖의 backlog와 보관 후보

2026-10-10 · DEC-013·016 기준. 이번 미션은 Worker 없는 Studio의 최종 기능 검증까지다.
후속 작업·보관 후보의 추적 저장소는 인간이 지정한 [hypeproof/hype-luwak](https://github.com/hypeproof/hype-luwak)이다. 후속 이슈 [#1–#6](https://github.com/hypeproof/hype-luwak/issues)은 조직 칸반 Backlog에 등록됐다.
이 목록은 후속 작업과 보관 후보를 추적한다. 사용 중인 기능을 폐기 대상으로 취급하지 않는다.

## 후속 작업

| 항목 | 위치·근거 | 이번 처리 |
|---|---|---|
| Chalk 웹 화면을 Studio App으로 통합 | `chalk/src/ui`, `docs/plan/studio-chalk-boundary.md` | Backlog. 기존 웹 기능 보존 |
| Studio·Chalk의 비Worker 책임·공통 로컬 실행 구조 정리 | `extensions/hypeproof-chat/src/chalk`, `chatPanelProvider.ts` | Backlog. 이번 Worker 의존 제거 외 리팩터링 제외 |
| HTML 지도안과 session-design의 관계·통합 검토 | `docs/plan/studio-chalk-boundary.md` | Backlog. 서로 다른 산출물·API라 중복으로 단정하지 않음 |
| 운영 배포 주체 이전·운영 확인 | Service issue [#10](https://github.com/hypeproof/hypeproof-service/issues/10) | 최종 코드 분리 검증과 별도 추적 |
| 전체 원본 Git 이력 연결 | Service issue [#14](https://github.com/hypeproof/hypeproof-service/issues/14) | 현재 원본 커밋·경로·해시 근거 보존, 전체 이력 연결은 후속 |

## 복구 가능한 보관 후보

| 후보 | 판단 상태 | 보관 전에 확인할 것 |
|---|---|---|
| `proxy-poc/` | 참조·보관 검토 후보. 미삭제·미이동 | 실제 실행·문서·도구 참조, 현 Service와 기능 관계, 복구 위치·방법 |

Worker 연결 제거에 필요한 코드·테스트·도구는 이 목록으로 미루지 않는다.
추가 후보는 사용 여부와 의존성을 확인한 뒤 경로·이유·복구 방법과 함께 기록한다.
## hype-luwak 추적 이슈

1. [Chalk App 통합](https://github.com/hypeproof/hype-luwak/issues/1)
2. [비Worker 책임 검토](https://github.com/hypeproof/hype-luwak/issues/2)
3. [HTML 지도안·session-design 관계](https://github.com/hypeproof/hype-luwak/issues/3)
4. [운영 이전](https://github.com/hypeproof/hype-luwak/issues/4) — Service #10 연결
5. [전체 Git 이력 연결](https://github.com/hypeproof/hype-luwak/issues/5) — Service #14 연결
6. [proxy-poc 사용·재사용 가능한 보관 검토](https://github.com/hypeproof/hype-luwak/issues/6)

최신 DEC-021: 짬통은 현재 미사용이 확인된 코드의 복구 가능한 보관 위치다. 애매한 코드와 후속 업무는 backlog에서 검토한다. 위 후보는 아직 실제 보관·폐기가 확정되지 않았다. 원본이 Studio·Service에 남아 있어도 정상 동작해야 한다.
패키지 설치·import 연결·원본 삭제·강제 이전은 Worker 분리의 전제나 완료 조건이 아니다.
패키징 담당 작업은 일시 중단했다. 기존 추적 이슈는 보존하며 Worker 분리를 우선한다.
향후 실제 소비 요구가 생기면 원본 보존·재사용 방법을 별도로 검토한다.
