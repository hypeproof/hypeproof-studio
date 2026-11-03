// REQ-KNOW-35 (CGP-KNOW-R-019, DES-KNOW-35) — free space on the work folder's volume is under the
// threshold. One persistent bar above the composer: it has no close button (it leaves when the host
// measures enough space again), no purchase or upgrade control, and it holds nothing: the draft,
// Send and every file stay usable. "공간 확보 방법" is a disclosure with the steps the host chose
// for this seat and platform. All text is rendered as React text, never as HTML.

import { useId, useState } from "react";
import type { LowDiskNotice } from "../../src/lowDisk";

export function LowDiskBar({ notice }: { notice: LowDiskNotice }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="hps-low-disk" role="status" aria-live="polite" aria-atomic="false" data-testid="low-disk-bar">
      <p className="hps-low-disk-text">{notice.text}</p>
      <button type="button" className="hps-low-disk-help" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{notice.help}</button>
      <div id={id} className="hps-low-disk-detail" hidden={!open}>
        <p className="hps-low-disk-amounts">{notice.amounts}</p>
        <ol className="hps-low-disk-steps">{notice.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        <p className="hps-low-disk-keep">{notice.keep}</p>
      </div>
    </section>
  );
}
