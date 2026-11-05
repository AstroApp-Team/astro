/**
 * The shell's header: which scene, which sheet, and the transport.
 *
 * The scene picker is a `<select>`, not a custom menu, because it is the one control whose
 * options must be readable at a glance and navigable from the keyboard: ten scenes with their
 * sheet ids is a list, and a popover that has to re-implement typeahead for it is a worse list.
 *
 * Transport writes go through `SheetPlayback`, never through `sequence.position` here — the
 * adapter exists so that a page does not mutate a Theatre object the React Compiler is tracking.
 */

import { useEffect, useState } from "react";

import { SCENE_IDS, type SceneId } from "@core/models/scene.ts";
import { SCENE_SHEET_IDS } from "@infra/theatre/project.ts";
import type { SheetPlayback } from "@infra/theatre/useSheetPlayback.ts";

export function HeaderBar({
  scene,
  playback,
  studioUi,
  studioAvailable,
  onToggleStudio,
  onScene,
  status,
}: {
  scene: SceneId;
  playback: SheetPlayback;
  studioUi: boolean;
  studioAvailable: boolean;
  onToggleStudio: () => void;
  onScene: (scene: SceneId) => void;
  status: string;
}) {
  const [playhead, setPlayhead] = useState(() => playback.position());
  const length = playback.length();

  /* A live readout, at 10 Hz: this component is the only one re-rendering for it. */
  useEffect(() => {
    const timer = setInterval(() => {
      setPlayhead(playback.position());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [playback]);

  return (
    <header className="st-header">
      <div className="st-header__brand">
        <span className="st-header__dot" />
        <strong>Rig studio</strong>
      </div>

      <label className="st-header__scene">
        <span className="ed-mono">Scene</span>
        <select
          className="ed-input st-header__select"
          value={scene}
          onChange={(event) => {
            const next = SCENE_IDS.find((id) => id === event.target.value);
            if (next != null) onScene(next);
          }}
        >
          {SCENE_IDS.map((id) => (
            <option key={id} value={id}>
              {id} · {SCENE_SHEET_IDS[id]}
            </option>
          ))}
        </select>
      </label>

      <div className="st-transport">
        <button
          type="button"
          className="ed-btn ed-btn--play"
          onClick={() => {
            playback.play([0, Math.max(0.001, length)]);
          }}
          title="Play the sequence"
        >
          ▶
        </button>
        <button
          type="button"
          className="ed-btn"
          onClick={() => {
            playback.loop([0, Math.max(0.001, length)]);
          }}
          title="Loop the sequence"
        >
          ⟳
        </button>
        <button
          type="button"
          className="ed-btn"
          onClick={() => {
            playback.reset();
            setPlayhead(0);
          }}
          title="Stop and rewind"
        >
          ■
        </button>
        <span className="ed-mono st-transport__readout">
          {playhead.toFixed(2)} / {length.toFixed(2)}s
        </span>
      </div>

      <div className="st-header__actions">
        <span className="st-header__status">{status}</span>
        <button
          type="button"
          className="ed-btn ed-btn--ghost"
          onClick={onToggleStudio}
          disabled={!studioAvailable}
          title={
            studioAvailable
              ? "Show or hide the Theatre.js Studio panel"
              : "The Studio only loads in dev, on a desktop browser"
          }
        >
          {studioUi ? "Hide Studio" : "Studio"}
        </button>
      </div>
    </header>
  );
}
