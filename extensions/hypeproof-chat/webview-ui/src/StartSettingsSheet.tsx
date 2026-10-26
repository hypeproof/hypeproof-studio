import { ChatPreferences } from "./ChatPreferences";
import { postToHost } from "./vscode";
import { TEXT_SIZES, TEXT_SIZE_LABELS } from "../../src/textSize";
import { REDUCE_MOTION_CHOICES, START_SETTINGS_COPY as C, startSettingsView, type StartSettingsView } from "../../src/startSettings";

/**
 * CGP-SHELL-R-014 — the learner settings sheet behind the start page "설정". It lists only the rows
 * the host's view names (at most six) and "고급 설정" only when the host allows it. Every choice is
 * posted to the host, which validates and stores it and sends the new view back.
 */
export function StartSettingsSheet({ open, onClose, opener, view }: { open: boolean; onClose: () => void; opener: () => HTMLElement | null; view?: StartSettingsView }) {
  if (!open) return null;
  // A host that has not sent a view yet: the conservative default (no advanced entry).
  const v = view ?? startSettingsView({ textSize: undefined, reduceMotion: undefined, notices: false, profileMinor: true, age: undefined });
  const rows = v.rows;
  return <ChatPreferences open={open} onClose={onClose} opener={opener} title={C.title} closeLabel={C.close} className="studio-settings">
    {rows.includes("textSize") && <fieldset className="hps-text-size studio-settings-row" aria-describedby="studio-settings-text-hint">
      <legend>{C.textSize}</legend>
      {TEXT_SIZES.map(size => <label key={size}>
        <input type="radio" name="studio-text-size" value={size} checked={v.textSize === size}
          onChange={() => postToHost({ type: "startSetting", key: "textSize", value: size })} />
        <span>{TEXT_SIZE_LABELS[size]}</span>
      </label>)}
      <p id="studio-settings-text-hint" className="studio-settings-hint">{C.textSizeHint}</p>
    </fieldset>}
    {rows.includes("reduceMotion") && <fieldset className="hps-text-size studio-settings-row">
      <legend>{C.reduceMotion}</legend>
      {REDUCE_MOTION_CHOICES.map(choice => <label key={choice}>
        <input type="radio" name="studio-reduce-motion" value={choice} checked={v.reduceMotion === choice}
          onChange={() => postToHost({ type: "startSetting", key: "reduceMotion", value: choice })} />
        <span>{C.reduceMotionLabels[choice]}</span>
      </label>)}
    </fieldset>}
    {rows.includes("notices") && <fieldset className="hps-text-size studio-settings-row" aria-describedby="studio-settings-notice-hint">
      <legend>{C.notices}</legend>
      <label>
        <input type="checkbox" checked={v.notices} onChange={event => postToHost({ type: "startSetting", key: "notices", value: event.currentTarget.checked })} />
        <span>{C.noticesLabel}</span>
      </label>
      <p id="studio-settings-notice-hint" className="studio-settings-hint">{C.noticesHint}</p>
    </fieldset>}
    {v.advanced && <button type="button" className="hps-all-settings studio-settings-advanced" onClick={() => { onClose(); postToHost({ type: "openAdvancedSettings" }); }}>{C.advanced}</button>}
  </ChatPreferences>;
}
