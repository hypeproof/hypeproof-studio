import "./refusalBanner.css";

/** A passive sibling of the composer: arrival never focuses or remounts the editor. */
export function RefusalBanner({ onDismiss }: { onDismiss: () => void }) {
  return <section className="hps-refusal-banner" role="status" aria-live="polite" aria-atomic="true">
    <div>
      <strong>AI가 이 요청에는 답하지 않았어요.</strong>
      <p>이렇게 해 볼 수 있어요: 하려는 일을 설명하고, 가능한 다른 방법을 물어보세요.</p>
      <p>이미 저장된 변경이 있는지 작업 파일도 확인해 주세요.</p>
    </div>
    <button type="button" aria-label="거절 안내 닫기" onClick={onDismiss}>닫기</button>
  </section>;
}
