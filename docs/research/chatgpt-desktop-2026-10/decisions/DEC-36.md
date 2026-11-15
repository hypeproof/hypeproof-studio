## DEC-36: Service migrations 0086–0094 and deploy (2026-11-15, Jay)

An operations decision; there is no CGP row.

- Question 1: "운영 DB가 0085인데 main은 0090이 필요해요. … 적용하고 배포할까요?" Chosen option: "적용하고 배포". Confirmed by Jay: yes (2026-11-15).
- Follow-up question about 0091–0094. Chosen option: "0094까지 함께 적용". Confirmed by Jay: yes (2026-11-15).
- Run conditions, attached by the loop and not part of Jay's answer (agent choice, Confirmed by Jay: no):
  - outside class hours;
  - a restore bookmark first;
  - the live-session check;
  - a read-only count of seat `actor='teacher'` rows.
- Outcome: when it was checked at 10:4xZ, prod D1 was already at 0094 and the Service was already deployed as service-v2026.11.15-1 (e8c8bcc68) by another session. This loop applied and deployed nothing. The read-only count was 0 rows (`ops_events` is empty).
