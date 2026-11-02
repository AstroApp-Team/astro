/**
 * The bar that owns the document: what is open, how it plays, and whether it is saved.
 *
 * It is also the only place that knows the *machine* is playing rather than paused, because
 * `playing` is session state and the transport is the one control that must always be
 * reachable — a play button inside the stage scrolls away the moment the graph is panned, and
 * a Save button in a menu is a Save button nobody presses.
 */

import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import { layoutDefinition } from "@core/usecases/animationStateMachine/editorLayout.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useMachineStore } from "@presentation/state/useMachineStore.ts";

function LayerTab({ layer, active }: { layer: string; active: boolean }) {
  const select = useEditorStore((state) => state.select);
  const setDebug = useEditorStore((state) => state.setDebug);
  const setLayer = () => {
    setDebug({ selectedLayer: layer });
    select({ kind: "layer", layer });
  };
  return (
    <button
      type="button"
      className="ed-tab"
      data-active={active ? "true" : undefined}
      onClick={setLayer}
    >
      {layer}
    </button>
  );
}

export function Header({ definition }: { definition: MachineDefinition }) {
  const dirty = useEditorStore((state) => state.dirty);
  const source = useEditorStore((state) => state.source);
  const status = useEditorStore((state) => state.status);
  const error = useEditorStore((state) => state.error);
  const mode = useEditorStore((state) => state.mode);
  const playing = useEditorStore((state) => state.playing);
  const rebuild = useEditorStore((state) => state.rebuild);
  const setMode = useEditorStore((state) => state.setMode);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const setRebuild = useEditorStore((state) => state.setRebuild);
  const save = useEditorStore((state) => state.save);
  const discard = useEditorStore((state) => state.discard);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const fileLayer = useEditorStore((state) => state.file.debug.selectedLayer);
  const phase = useMachineStore((state) => state.frames);

  const selected =
    definition.layers.find((layer) => layer.id === fileLayer) ?? definition.layers[0];
  const layout = layoutDefinition(definition);

  return (
    <header className="ed-header">
      <div className="ed-header__brand">
        <span className="ed-header__dot" aria-hidden="true" />
        <strong>{definition.name}</strong>
        <span className="ed-header__file">{definition.scene ?? "no scene"}</span>
        <span className="ed-header__state" data-dirty={dirty ? "true" : undefined}>
          {dirty ? "unsaved" : source === "shipped" ? "shipped" : "saved"}
        </span>
      </div>

      <div className="ed-header__tabs" role="tablist" aria-label="Layers">
        {definition.layers.map((layer) => (
          <LayerTab key={layer.id} layer={layer.id} active={layer.id === selected?.id} />
        ))}
      </div>

      <div className="ed-header__stage" aria-label="Stage mode">
        {(["graph", "timeline", "split"] as const).map((row) => (
          <button
            key={row}
            type="button"
            className="ed-segment"
            data-active={mode === row ? "true" : undefined}
            onClick={() => setMode(row)}
          >
            {row}
          </button>
        ))}
      </div>

      <div className="ed-header__actions">
        <button
          type="button"
          className="ed-btn"
          onClick={undo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          type="button"
          className="ed-btn"
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          ↷
        </button>
        <button
          type="button"
          className="ed-btn ed-btn--play"
          data-active={playing ? "true" : undefined}
          onClick={() => setPlaying(!playing)}
          title="Play / pause (Space)"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="ed-header__phase" title="Frames stepped since the machine was built">
          {phase} f
        </span>
        <button type="button" className="ed-btn" onClick={() => void save()} disabled={!dirty}>
          Save
        </button>
        <button type="button" className="ed-btn ed-btn--ghost" onClick={discard}>
          Discard
        </button>
      </div>

      {rebuild == null ? null : (
        <output className="ed-header__rebuild">
          {/* A structural edit is a new machine; the banner says so and lets the reader keep the
              old playback instead of silently resetting their test (§4.5). */}
          <span>
            The definition changed shape — playback starts over. {layout.nodes == null ? "" : ""}
          </span>
          <button type="button" className="ed-btn ed-btn--ghost" onClick={() => setRebuild(null)}>
            Keep playing
          </button>
        </output>
      )}
      {error == null ? null : <div className="ed-header__error">{error}</div>}
      {status === "" ? null : <div className="ed-header__status">{status}</div>}
    </header>
  );
}
