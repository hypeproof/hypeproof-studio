// CGP-LEARN-R-006 / D-006 (box_spacing), CGP-LEARN-R-005 / D-005 (stage_stepper) and CGP-LEARN-R-009 / D-009
// (narrated_diagram): the parametric learning blocks,
// drawn inside the existing 자료 card (LessonStepPanel). Both are controlled: LessonStepPanel holds the values and the stage
// index, so the card's polite caption (R-003) is computed from the same state. Nothing here posts to the host.
import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  BOX_BOUNDS, BOX_LAYOUT_LABELS, BOX_PARAM_LABELS, boxStyle, clampLayout, rangeKeyStep, stageLabel, stageMove,
  type BoxLayout, type BoxValues, type Stage, type Beat,
} from "../../src/blockParams";
import {
  ARTBOARD, DIAGRAMS, DIAGRAM_TEXT, LETTER_UNITS, MARKER_RADIUS, beatLabel, beatMove, diagramAriaLabel, partRole, type DiagramId,
} from "../../src/narratedDiagram";
import { imeComposing } from "./imeGuard";

const LAYOUTS: readonly BoxLayout[] = ["block", "inline-block", "flex", "grid"];

/**
 * DES-CGP-LEARN-06 — one bounded integer: a native range with its value as text, ←/→ ±1, PageUp/PageDown ±10 % of the range,
 * Home/End. The keys are handled here (not left to the browser) so the step is the same everywhere; none fires while a Korean
 * IME composition is open.
 */
export function RangeParam(props: { name: string; label: string; value: number; min: number; max: number; unit: string; onChange(v: number): void }) {
  const id = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (imeComposing(e)) return;
    const next = rangeKeyStep(e.key, props.value, props.min, props.max);
    if (next === null) return;
    e.preventDefault();
    if (next !== props.value) props.onChange(next);
  };
  return (
    <div className="hp-param" data-param={props.name}>
      <label htmlFor={id} className="hp-param-label">{props.label}</label>
      <input id={id} type="range" min={props.min} max={props.max} step={1} value={props.value}
        aria-valuetext={`${props.value}${props.unit}`} onKeyDown={onKeyDown}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n)) props.onChange(Math.min(props.max, Math.max(props.min, n))); }} />
      <output htmlFor={id} className="hp-param-value" data-param-value={props.name}>{props.value}{props.unit}</output>
    </div>
  );
}

/**
 * DES-CGP-LEARN-06 — a fixed choice. Up to 4 options: a segmented radio group (native radios: arrows move, Space picks).
 * More than 4: one button "{값}. {라벨} 전체 보기" that opens the whole list in place.
 */
export function EnumParam(props: { name: string; label: string; value: string; options: readonly { value: string; label: string }[]; onChange(v: string): void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value) ?? props.options[0];
  const radios = (
    <div className={props.options.length <= 4 ? "hp-param-segments" : "hp-param-list"} id={id + "l"}>
      {props.options.map((o) => (
        <label key={o.value} className="hp-param-option">
          <input type="radio" name={id} value={o.value} checked={o.value === props.value} onChange={() => { props.onChange(o.value); setOpen(false); }} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
  return (
    <fieldset className="hp-param" data-param={props.name}>
      <legend className="hp-param-label">{props.label}</legend>
      {props.options.length <= 4 ? radios : <>
        <button type="button" className="hp-cta-quiet hp-param-overflow" aria-expanded={open} aria-controls={id + "l"} data-param-overflow=""
          onClick={() => setOpen((v) => !v)}>{`${current.label}. ${props.label} 전체 보기`}</button>
        {open && radios}
      </>}
    </fieldset>
  );
}

/**
 * box_spacing v1 — the controls and a static preview. The preview is built from a style OBJECT of clamped numbers
 * (blockParams.boxStyle): no style text, no <style> block, no learner or authored markup, no script. The sample content is
 * fixed copy.
 */
export function BoxSpacingBlock(props: { values: BoxValues; onChange(next: BoxValues): void }) {
  const v = props.values;
  const set = (patch: Partial<BoxValues>) => props.onChange({ ...v, ...patch });
  const s = boxStyle(v);
  return (
    <div className="hp-box-spacing" data-surface="box_spacing">
      <div className="hp-box-preview" aria-hidden="true">
        <div className="hp-box-margin" data-box-margin="">
          <div className="hp-box-outer" data-box-outer="" data-box-layout={clampLayout(v.layout)}
            style={{ "--param-padding": s["--param-padding"], "--param-border": s["--param-border"], "--param-margin": s["--param-margin"] } as CSSProperties}>
            <span className="hp-box-content" data-box-content="">내용</span>
          </div>
        </div>
      </div>
      <div className="hp-box-controls">
        {(["padding", "border", "margin"] as const).map((name) => (
          <RangeParam key={name} name={name} label={BOX_PARAM_LABELS[name]} value={v[name]} min={BOX_BOUNDS[name].min} max={BOX_BOUNDS[name].max} unit="px"
            onChange={(n) => set({ [name]: n } as Partial<BoxValues>)} />
        ))}
        <EnumParam name="layout" label={BOX_PARAM_LABELS.layout} value={v.layout} options={LAYOUTS.map((value) => ({ value, label: BOX_LAYOUT_LABELS[value] }))}
          onChange={(layout) => set({ layout: layout as BoxLayout })} />
      </div>
    </div>
  );
}

/**
 * stage_stepper v1 — one stage at a time: "2 / 4 단계", its title and one sentence, 이전 / 다음. It moves only on the learner's
 * action (no timer); ←/→ also move while the stepper has focus (never during an IME composition). The stages are
 * instructor text and untrusted: they are React text nodes only, never markup, links or markdown.
 */
export function StageStepperBlock(props: { stages: readonly Stage[]; index: number; onMove(next: number): void }) {
  const n = props.stages.length, i = Math.min(n - 1, Math.max(0, props.index)), stage = props.stages[i];
  const move = (by: number) => { const next = stageMove(i, n, by); if (next !== i) props.onMove(next); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (imeComposing(e)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
  };
  return (
    <div className="hp-stage-stepper" data-surface="stage_stepper" tabIndex={0} role="group" aria-label={stageLabel(i, n)} onKeyDown={onKeyDown}>
      <p className="hp-stage-count" data-stage-count="">{stageLabel(i, n)}</p>
      <h4 className="hp-stage-title" data-stage-title="">{stage.title}</h4>
      <p className="hp-stage-sentence" data-stage-sentence="">{stage.sentence}</p>
      <div className="hp-stage-nav">
        <button type="button" className="hp-cta-quiet" data-stage-prev="" disabled={i === 0} onClick={() => move(-1)}>이전</button>
        <button type="button" className="hp-cta-quiet" data-stage-next="" disabled={i === n - 1} onClick={() => move(1)}>다음</button>
      </div>
    </div>
  );
}

/**
 * CGP-LEARN-R-009 / D-009 — narrated_diagram v1: one of Studio's built-in drawings, three instructor beats (시작 / 변화 /
 * 결과). Only the shapes are SVG and they scale with the rail (viewBox 640x400); every word is HTML at 14 px or more —
 * the legend of node labels (same letters as the boxes), "2 / 3 장면 · 변화", the beat title and its sentence — so text never
 * scales below the floor in a 280 px rail (decisions/CGP-LEARN-R-009.md). Colours are role classes resolved by tokens.
 * The marker is a ring with a dot; the position is the HTML line.
 * Beats move only on the learner's action (이전 / 다음, or ←/→ while focused; never during an IME composition). The beats
 * are instructor text and untrusted: React text nodes only, never markup, links or markdown.
 */
export function NarratedDiagramBlock(props: { diagram: DiagramId; beats: readonly Beat[]; index: number; onMove(next: number): void }) {
  const i = Math.min(2, Math.max(0, props.index)), beat = props.beats[i], d = DIAGRAMS[props.diagram], t = DIAGRAM_TEXT[props.diagram];
  const move = (by: number) => { const next = beatMove(i, by); if (next !== i) props.onMove(next); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (imeComposing(e)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
  };
  const [mx, my] = d.beats[i].marker;
  return (
    <div className="hp-diagram" data-surface="narrated_diagram" data-diagram={props.diagram} data-beat={i} tabIndex={0} role="group" aria-label={`${t.name} · ${beatLabel(i)}`} onKeyDown={onKeyDown}>
      <svg className="hp-diagram-art" viewBox={`0 0 ${ARTBOARD.width} ${ARTBOARD.height}`} role="img" aria-label={diagramAriaLabel(props.diagram)} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id={`hp-diagram-head-${props.diagram}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="hp-diagram-head" />
          </marker>
        </defs>
        {d.nodes.map((n) => (
          <g key={n.id} data-part={n.id} data-role={partRole(props.diagram, i, n.id, "node")}>
            <rect className="hp-diagram-node" x={n.x} y={n.y} width={n.w} height={n.h} rx={12} strokeWidth={partRole(props.diagram, i, n.id, "node") === "accent" ? 6 : 3} />
            <text className="hp-diagram-letter" x={n.x + n.w / 2} y={n.y + n.h / 2} aria-hidden="true" dominantBaseline="central" textAnchor="middle" fontSize={LETTER_UNITS}>{n.letter}</text>
          </g>
        ))}
        {d.arrows.map((a) => (
          <line key={a.id} data-part={a.id} data-role={partRole(props.diagram, i, a.id, "arrow")} className="hp-diagram-arrow"
            x1={a.from[0]} y1={a.from[1]} x2={a.to[0]} y2={a.to[1]} strokeWidth={partRole(props.diagram, i, a.id, "arrow") === "accent" ? 6 : 4} markerEnd={`url(#hp-diagram-head-${props.diagram})`} />
        ))}
        {/* The beat's marker carries no numeral: the position is the HTML "N / 3 장면" line (a lone digit reads as a score). */}
        <g className="hp-diagram-marker" data-marker={i + 1} aria-hidden="true">
          <circle cx={mx} cy={my} r={MARKER_RADIUS} />
          <circle className="hp-diagram-marker-core" cx={mx} cy={my} r={MARKER_RADIUS / 3} />
        </g>
      </svg>
      <ul className="hp-diagram-legend" aria-label="그림 안의 글자">
        {d.nodes.map((n) => <li key={n.id} data-legend={n.id}><span className="hp-diagram-legend-letter">{n.letter}</span> {t.nodes[n.id]}</li>)}
      </ul>
      <div className="hp-diagram-beat">
        <div className="hp-diagram-caption">
          <p className="hp-diagram-count" data-beat-count="">{beatLabel(i)}</p>
          <h4 className="hp-diagram-title" data-beat-title="">{beat.title}</h4>
          <p className="hp-diagram-sentence" data-beat-sentence="">{beat.sentence}</p>
        </div>
        <div className="hp-diagram-controls" role="group" aria-label="장면 넘기기">
          <button type="button" className="hp-cta-quiet" data-beat-prev="" disabled={i === 0} onClick={() => move(-1)}>이전</button>
          <button type="button" className="hp-cta-quiet" data-beat-next="" disabled={i === 2} onClick={() => move(1)}>다음</button>
        </div>
      </div>
    </div>
  );
}
