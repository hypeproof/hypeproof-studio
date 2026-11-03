/** One explicit model-refusal notice per live turn; never revive a stopped turn. */
export function modelRefusalNotifier(signal: AbortSignal, settled: () => boolean, notify: () => void): () => void {
  let shown = false;
  return () => {
    if (signal.aborted || settled() || shown) return;
    shown = true;
    notify();
  };
}
