import { ChatPreferences } from "./ChatPreferences";
import { postToHost } from "./vscode";
import { TEXT_SIZES, TEXT_SIZE_LABELS, type TextSize } from "../../src/textSize";
import { REDUCE_MOTION_CHOICES, START_SETTINGS_COPY as C, startSettingsView, type ReduceMotionChoice, type StartSettingsView } from "../../src/startSettings";

/**
 * CGP-SHELL-R-014 — the learner settings sheet behind the start page "설정". It lists only the rows
 * the host's view names (at most six) and "고급 설정" only when the host allows it. Every choice is
 * posted to the host, which validates and stores it and sends the new view back.
 * CGP-SHELL-D-013 (DES-SHELL-13) — a right-side sheet: each row is one 48px line, its name on the
 * left and one control on the right, so a row fits on one line at 320px. A row's note sits under
 * the row and is the control's description.
 */
export function StartSettingsSheet({ open, onClose, opener, view }: { open: boolean; onClose: () => void; opener: () => HTMLElement | null; view?: StartSettingsView }) {
  if (!open) return null;
  // A host that has not sent a view yet: the conservative default (no advanced entry).
  const v = view ?? startSettingsView({ textSize: undefined, reduceMotion: undefined, notices: false, profileMinor: true, age: undefined });
  const rows = v.rows;
  return <ChatPreferences open={open} onClose={onClose} opener={opener} title={C.title} closeLabel={C.close} className="studio-settings">
    {rows.includes("textSize") && <>
      <div className="studio-settings-row">
        <label htmlFor="studio-text-size">{C.textSize}</label>
        <select id="studio-text-size" name="studio-text-size" value={v.textSize} aria-describedby="studio-settings-text-hint"
          onChange={event => postToHost({ type: "startSetting", key: "textSize", value: event.currentTarget.value as TextSize })}>
          {TEXT_SIZES.map(size => <option key={size} value={size}>{TEXT_SIZE_LABELS[size]}</option>)}
        </select>
      </div>
      <p id="studio-settings-text-hint" className="studio-settings-hint">{C.textSizeHint}</p>
    </>}
    {rows.includes("reduceMotion") && <div className="studio-settings-row">
      <label htmlFor="studio-reduce-motion">{C.reduceMotion}</label>
      <select id="studio-reduce-motion" name="studio-reduce-motion" value={v.reduceMotion}
        onChange={event => postToHost({ type: "startSetting", key: "reduceMotion", value: event.currentTarget.value as ReduceMotionChoice })}>
        {REDUCE_MOTION_CHOICES.map(choice => <option key={choice} value={choice}>{C.reduceMotionLabels[choice]}</option>)}
      </select>
    </div>}
    {rows.includes("notices") && <>
      <div className="studio-settings-row">
        <label htmlFor="studio-notices">{C.notices}</label>
        <label className="studio-settings-check" htmlFor="studio-notices">
          <input id="studio-notices" type="checkbox" checked={v.notices} aria-describedby="studio-settings-notice-hint"
            onChange={event => postToHost({ type: "startSetting", key: "notices", value: event.currentTarget.checked })} />
        </label>
      </div>
      <p id="studio-settings-notice-hint" className="studio-settings-hint">{C.noticesLabel} {C.noticesHint}</p>
    </>}
    {v.advanced && <button type="button" className="studio-settings-row studio-settings-advanced" onClick={() => { onClose(); postToHost({ type: "openAdvancedSettings" }); }}>{C.advanced}</button>}
  </ChatPreferences>;
}
