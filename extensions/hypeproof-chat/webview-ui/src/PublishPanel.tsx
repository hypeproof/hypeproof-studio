// "사용자 테스트용으로 공개" panel (cr-publish, #1393; CR-17–CR-22, CR-39, CR-64, CR-73, CR-81).
//
// Draws what the host computed (`PublishView`) and sends the student's own actions back. It
// decides nothing: whether the version is verified (CR-81), what is in the published set,
// the refusal of a file, the links and their QR codes are the host's and the Service's. A
// disabled button here is a picture, not a lock (the host and the Service refuse by name).
import { useEffect, useId, useRef, useState } from "react";
import { ChatIcon } from "./ChatDetails";
import { useDialogFocus } from "./dialogFocus";
import type { PublishForm, PublishView } from "../../src/publishView";
import { EXPIRY_CHOICES, METHOD_CHOICES, SHARING_UNKNOWN } from "../../src/publishView";

import { activePublishLink, publishSharing } from "../../src/publishSharing";

const VERIFIED_LINE: Record<PublishView["verification"]["state"], string> = {
  verified: "검증됨 · 이 버전은 기대 조건을 모두 통과했어요",
  failed: "검증 안 됨 · 통과하지 못한 조건이 있어요",
  incomplete: "검증 안 됨 · 확인되지 않은 조건이 있어요",
  needs_recheck: "검증 안 됨 · 파일이 바뀐 뒤 아직 다시 테스트하지 않았어요",
  not_verified: "검증 안 됨 · 이 버전은 아직 테스트하지 않았어요",
};
const LINK_STATE: Record<string, string> = { live: "열림", revoked: "꺼짐", expired: "기간 끝남" };
const shortId = (id: string | null) => (id ? id.replace(/^sha256:/, "").slice(0, 8) : "—");
const day = (ms: number) => new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ExpiryPicker(props: { value: number | null; onChange(v: number): void; name: string }) {
  return (
    <div className="hps-publish-expiry" role="radiogroup" aria-label="링크 기간">
      <span>링크 기간</span>
      {EXPIRY_CHOICES.map((d) => (
        <label key={d}>
          <input type="radio" name={props.name} checked={props.value === d} onChange={() => props.onChange(d)} data-testid={`${props.name}-${d}`} /> {d}일
        </label>
      ))}
    </div>
  );
}

export function PublishPanel(props: {
  view: PublishView;
  error: string | null;
  errorLines: string[];
  shareUrl: string | null;
  busy: boolean;
  onManifest(paths: string[]): void;
  onSubmit(form: PublishForm): void;
  onLink(experimentId: string, channel: string, expiresInDays: number): void;
  onRevoke(linkId: string): void;
  onCopy?(versionId: string): void;
  onRefresh?(): void;
  onClose(): void;
}) {
  // REQ-STUDIO-FOCUS-RESTORE: host-opened inline panel; closing returns focus, never to <body>.
  const panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, { open: true, kind: "inline", initialFocus: "idle" });
  const { view } = props;
  const [now, setNow] = useState(Date.now());
  const refresh = useRef(props.onRefresh);
  refresh.current = props.onRefresh;
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => refresh.current?.(), 15000);
    const focus = () => { setNow(Date.now()); refresh.current?.(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(clock); clearInterval(poll); window.removeEventListener('focus', focus); };
  }, []);
  const versions = [...new Set([view.version.id, ...view.experiments.map(e => e.product_version_id)])].filter((id): id is string => !!id);
  const stale = !!view.read_failed;
  const settingsId = useId();
  const settings = useRef<HTMLDetailsElement>(null);
  const currentSharing = publishSharing(view.version.id, view.experiments, now);
  const sharingState = stale || !view.available || !view.version.id ? 'unknown' : currentSharing.state;
  const sharingText = { live: '링크가 있는 누구나', closed: '링크 끊김', unpublished: '나만 볼 수 있어요', unknown: '공유 상태 확인 필요' }[sharingState];
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = () => {
    setSettingsOpen(true);
    if (settings.current) {
      settings.current.open = true;
      settings.current.scrollIntoView?.({ block: 'nearest' });
      settings.current.querySelector('summary')?.focus();
    }
  };
  const sharingPill = <button type="button" className="hps-sharing-pill" data-testid="sharing-pill" data-sharing={sharingState}
    aria-controls={settingsId} aria-expanded={settingsOpen} aria-label={`${sharingText} · 공유 설정`} onClick={openSettings}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      {sharingState === 'unpublished' ? <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>
        : sharingState === 'unknown' ? <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17v1"/></>
        : <><path d="m10 7 2-2a5 5 0 0 1 7 7l-2 2M7 10l-2 2a5 5 0 0 0 7 7l2-2"/>{sharingState === 'closed' ? <path d="m3 3 18 18"/> : <path d="m9 15 6-6"/>}</>}
    </svg><span>{sharingText}</span>
  </button>;

  const [hypothesisId, setHypothesisId] = useState<string>("");
  const [hypothesis, setHypothesis] = useState("");
  const [question, setQuestion] = useState("");
  const [method, setMethod] = useState<string>(METHOD_CHOICES[0].id);
  const [criteria, setCriteria] = useState("");
  const [channel, setChannel] = useState("");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [extraFile, setExtraFile] = useState("");
  const [devices, setDevices] = useState<Array<"camera" | "microphone">>([]);
  const [repeatedUse, setRepeatedUse] = useState(false);
  const [labels, setLabels] = useState("");
  const toggleDevice = (d: "camera" | "microphone", on: boolean) => setDevices((cur) => (on ? [...cur.filter((x) => x !== d), d] : cur.filter((x) => x !== d)));
  const [more, setMore] = useState<Record<string, { channel: string; expiry: number | null }>>({});
  const disabled = props.busy || !view.available;
  const criteriaList = criteria.split("\n").map((s) => s.trim()).filter(Boolean);
  const canSubmit = !disabled && !!view.version.id && expiry !== null && !!question.trim() && criteriaList.length > 0 && (!!hypothesisId || !!hypothesis.trim());
  const submit = () =>
    props.onSubmit({
      ...(hypothesisId ? { hypothesis_id: hypothesisId } : { hypothesis: hypothesis.trim() }),
      question: question.trim(),
      method,
      success_criteria: criteriaList,
      ...(channel.trim() ? { channel: channel.trim() } : {}),
      ...(expiry !== null ? { expires_in_days: expiry } : {}),
      ...(devices.length ? { devices } : {}),
      ...(repeatedUse ? { repeated_use: true } : {}),
      ...(labels.trim() ? { labels: labels.split("\n").map((s) => s.trim()).filter(Boolean) } : {}),
      manifest: view.version.manifest_added,
    });

  return (
    <section ref={panel} className="hps-publish" data-testid="publish-panel" aria-label="사용자 테스트용으로 공개">
      <header>
        <strong>사용자 테스트용으로 공개</strong>
        <button type="button" onClick={props.onClose} aria-label="닫기"><ChatIcon kind="close" size={16} /></button>
      </header>
      {!view.available && sharingPill}
      {!view.available && !view.read_failed && <p data-testid="publish-unavailable">{view.reason}</p>}
      {view.read_failed && (
        <div className="hps-publish-sharing" data-testid="publish-sharing-unknown" data-sharing="unknown">
          <div role="status">{view.reason ?? SHARING_UNKNOWN}{view.stale_at ? ` · 아래는 ${day(view.stale_at)}에 확인한 마지막 상태예요. 지금과 다를 수 있어요.` : ""}</div>
        </div>
      )}
      {props.error && (
        <div className="hps-publish-error" role="alert" data-testid="publish-error">
          {props.error}
          {props.errorLines.length > 0 && (
            <ul>
              {props.errorLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view.available && (
        <>
          <div className="hps-publish-version" data-testid="publish-version" data-version={view.version.id ?? ""}>
            <div data-testid="publish-verified" data-state={view.verification.state}>
              {VERIFIED_LINE[view.verification.state]}
            </div>
            <div>
              공개할 버전 {shortId(view.version.id)} · 파일 {view.version.files.length}개
            </div>
            {view.version.refusal && <div className="hps-publish-refusal" data-testid="publish-refusal">{view.version.refusal}{view.version.refusal_lines.length > 0 && <ul>{view.version.refusal_lines.map((l) => <li key={l}>{l}</li>)}</ul>}</div>}
            {view.version.files.length > 0 && (
              <details>
                <summary>올라갈 파일 보기</summary>
                <ul data-testid="publish-files">
                  {view.version.files.map((f) => (
                    <li key={f.path}>
                      {f.path} {view.version.manifest_added.includes(f.path) ? "(직접 추가)" : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="hps-publish-manifest">
              <input value={extraFile} onChange={(e) => setExtraFile(e.target.value)} placeholder="페이지가 직접 부르지 않는 파일 경로 (예: data/menu.json)" aria-label="추가할 파일 경로" />
              <button type="button" disabled={disabled || !extraFile.trim()} onClick={() => { props.onManifest([...view.version.manifest_added, extraFile.trim()]); setExtraFile(""); }}>
                파일 추가
              </button>
            </div>
          </div>

          <div className="hps-publish-sharing" aria-label="버전별 공유 상태">
            {versions.map(id => {
              const sharing = publishSharing(id, view.experiments, now);
              const copyReason = stale ? `${SHARING_UNKNOWN}. 확인한 뒤에 복사할 수 있어요.` : sharing.reason;
              return <div key={id} data-testid="publish-sharing" data-version={id} data-sharing={sharing.state} data-stale={stale ? "true" : undefined}>
                <div>버전 {shortId(id)}{id === view.version.id ? ' (지금 버전)' : ' (이전 버전)'}</div>
                <div role="status">{sharing.label} · 활성 링크 {sharing.count}개{stale ? ` · ${view.stale_at ? `${day(view.stale_at)}에 확인한 상태` : "마지막으로 확인한 상태"}` : ""}</div>
                <button type="button" disabled={disabled || stale || !sharing.url} title={copyReason ?? '이 버전의 활성 링크 복사'} onClick={() => { if (!stale && sharing.url && !disabled) props.onCopy?.(id); }}>링크 복사</button>
                {copyReason && <div>{copyReason}</div>}
              </div>;
            })}
          </div>

          <div className="hps-publish-form" data-testid="publish-form">
            {view.hypotheses.length > 0 && (
              <label>
                가설
                <select value={hypothesisId} onChange={(e) => setHypothesisId(e.target.value)} aria-label="가설 고르기">
                  <option value="">새 가설 적기</option>
                  {view.hypotheses.map((h) => (
                    <option key={h.id} value={h.id}>{h.statement}</option>
                  ))}
                </select>
              </label>
            )}
            {!hypothesisId && <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="이 테스트로 확인하려는 가설 (예: 처음 쓰는 사람도 혼자 주문할 수 있다)" aria-label="가설" rows={2} />}
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="알고 싶은 것 (예: 도움 없이 주문을 마칠 수 있나?)" aria-label="질문" />
            <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="방법">
              {METHOD_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={"성공 기준, 한 줄에 하나 (예: 5명 중 3명이 주문 완료)"} aria-label="성공 기준" rows={2} />
            <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="어디에 나눠 주나요? (예: 학교 게시판) — 비워 둬도 돼요" aria-label="채널" maxLength={40} />
            <fieldset className="hps-publish-declare" data-testid="publish-declare">
              <legend>제품이 쓰는 것 (쓰지 않으면 비워 두세요)</legend>
              <label>
                <input type="checkbox" checked={devices.includes("camera")} onChange={(e) => toggleDevice("camera", e.target.checked)} data-testid="publish-device-camera" /> 카메라
              </label>
              <label>
                <input type="checkbox" checked={devices.includes("microphone")} onChange={(e) => toggleDevice("microphone", e.target.checked)} data-testid="publish-device-microphone" /> 마이크
              </label>
              <label>
                <input type="checkbox" checked={repeatedUse} onChange={(e) => setRepeatedUse(e.target.checked)} data-testid="publish-repeated-use" /> 같은 사람이 다시 와서 쓰는지 볼래요
              </label>
              <small>카메라와 마이크는 참가자가 자기 휴대폰에서 직접 허락해야 켜져요.</small>
              <textarea value={labels} onChange={(e) => setLabels(e.target.value)} placeholder={"앱이 기록할 과제 이름, 한 줄에 하나 (예: 주문)"} aria-label="기록할 과제 이름" rows={2} data-testid="publish-labels" />
              <small>여기 적은 이름만 기록돼요.</small>
            </fieldset>
            <ExpiryPicker value={expiry} onChange={setExpiry} name="publish-expiry" />
            <div className="hps-publish-actions">
            <button type="button" data-testid="publish-submit" disabled={!canSubmit} onClick={submit}>
              공개하고 테스트 시작
            </button>
            {sharingPill}
            </div>
          </div>

          {props.shareUrl && (
            <div className="hps-publish-done" data-testid="publish-share-url">
              공개했어요: <code>{props.shareUrl}</code>
            </div>
          )}
          {view.timing && !view.timing.ok && (
            <div className="hps-publish-timing" data-testid="publish-timing">
              공개에 {(view.timing.ms / 1000).toFixed(1)}초 걸렸어요 (목표 10초 · 원인 {view.timing.cause})
            </div>
          )}

        </>
      )}
      <details ref={settings} id={settingsId} className="hps-share-settings" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
        <summary>공유 설정</summary>
        <p>{sharingState === 'unknown' ? (view.reason ?? SHARING_UNKNOWN) : `${currentSharing.label} · 활성 링크 ${currentSharing.count}개`}</p>
        {sharingState === 'unpublished' && <p>먼저 이 버전을 공개해야 링크를 만들 수 있어요.</p>}
        {sharingState === 'unknown' && <button type="button" className="hps-sharing-refresh" onClick={() => props.onRefresh?.()} disabled={props.busy}>상태 다시 확인</button>}
          {view.available && view.experiments.map((e) => (
            <div className="hps-publish-experiment" key={e.id} data-testid="publish-experiment" data-experiment={e.id}>
              <div>
                <strong>{e.question}</strong> · {e.week}주차 · 버전 {shortId(e.product_version_id)} {e.current_version ? "(지금 버전)" : "(이전 버전 · 이 실험은 계속 이 버전을 보여 줘요)"}
              </div>
              {e.hypothesis && <div>가설: {e.hypothesis}</div>}
              {e.sessions && (
                <div className="hps-publish-sessions" data-testid="publish-sessions">
                  링크를 연 횟수:{" "}
                  {[...Object.entries(e.sessions.channels).map(([k, n]) => `${k} ${n}`), `채널 이름 없음 ${e.sessions.unlabelled}`, `알 수 없음 ${e.sessions.unknown}`].join(" · ")}
                  <div className="hps-publish-note">연 횟수예요. 원한다는 뜻은 아니에요.</div>
                </div>
              )}
              {e.links.map((l) => (
                <div className="hps-publish-link" key={l.id} data-testid="publish-link" data-state={l.state}>
                  <div>
                    {l.channel ?? "채널 이름 없음"} · {LINK_STATE[l.state === "live" && !activePublishLink(l, now) ? "expired" : l.state] ?? l.state} · {day(l.expires_at)}까지
                  </div>
                  {activePublishLink(l, now) && (
                    <>
                      <code data-testid="publish-link-url">{l.share_url}</code>
                      {l.qr && <img src={l.qr} alt={`${l.share_url} QR 코드`} data-testid="publish-qr" width={140} height={140} />}
                      <button type="button" disabled={disabled} data-testid="publish-revoke" onClick={() => props.onRevoke(l.id)}>
                        링크 끄기
                      </button>
                    </>
                  )}
                </div>
              ))}
              {e.status === "running" && (
                <div className="hps-publish-more">
                  <input value={more[e.id]?.channel ?? ""} onChange={(ev) => setMore((m) => ({ ...m, [e.id]: { channel: ev.target.value, expiry: m[e.id]?.expiry ?? null } }))} placeholder="다른 채널 이름 (예: 1:1 메시지)" aria-label="다른 채널" maxLength={40} />
                  <ExpiryPicker value={more[e.id]?.expiry ?? null} onChange={(v) => setMore((m) => ({ ...m, [e.id]: { channel: m[e.id]?.channel ?? "", expiry: v } }))} name={`publish-more-${e.id}`} />
                  <button type="button" disabled={disabled || (more[e.id]?.expiry ?? null) === null} onClick={() => props.onLink(e.id, more[e.id]?.channel ?? "", more[e.id]!.expiry!)}>
                    링크 하나 더 만들기
                  </button>
                </div>
              )}
            </div>
          ))}
      </details>
    </section>
  );
}
