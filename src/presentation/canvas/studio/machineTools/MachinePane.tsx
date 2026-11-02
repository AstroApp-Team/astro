import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import {
  clipLayerId,
  hasLayer,
  withClipLayer,
  withoutLayer,
} from "@core/usecases/animationStateMachine/authoring.ts";
import { downloadDefinition } from "@infra/theatre/animationStateMachine/machineDefinitionStore.ts";
import { listTheatreClips } from "@infra/theatre/animationStateMachine/theatreAssetResolver.ts";
import {
  loadMachineDefinition,
  THEATRE_BONE_MAP,
  writeDefinitionOverride,
  clearDefinitionOverride,
} from "@presentation/canvas/machine/machineAuthoring.ts";
import { PANE_CSS } from "@presentation/canvas/studio/shapeTools/paneStyles.ts";

/**
 * The Machine pane: Theatre timelines → machine layers.
 *
 * ── Why this is not a node graph ────────────────────────────────────────────
 *
 * Rive's editor is a state graph. This pane does not draw one, and that is deliberate: the
 * graph is a *file* (`machine-demo.definition.json`, validated with a JSON path on failure),
 * and the part that was missing was not a canvas to drag boxes on — it was a way to make a
 * timeline rigged in the Studio playable by the machine. So the pane closes that loop and
 * nothing else: it lists the clips the project state actually contains, writes the layer that
 * plays one, and hands the result to `/machine`. Transitions are still authored in the JSON,
 * where a typo is a load error with a path instead of a silent no-op.
 *
 * ── What "saved" means here ─────────────────────────────────────────────────
 *
 * Two destinations, on purpose. `localStorage` is the fast loop: press "Add as layer", reload
 * `/machine`, watch it play — no build, no file. The download is the durable one: it carries
 * the same JSON to `definitions/`, which is what ships. Writing straight to the repository
 * would need a third writer on `states/`, and the Studio's Save already owns those two files.
 *
 * The clips are read from the exported project state at module scope, so a Studio Save that
 * added a keyframe is picked up by reloading the page — the same rule the rest of the app
 * follows, and the reason there is no "refresh" button here.
 */

const CLIPS = listTheatreClips();
const DOWNLOAD_NAME = "machine-demo.definition.json";

function formatChannels(channels: readonly string[]): string {
  return channels.map((channel) => (channel === "rotationQuat" ? "quat" : channel)).join(" · ");
}

export default function MachinePane() {
  const [definition, setDefinition] = useState<MachineDefinition>(() => loadMachineDefinition());
  const [status, setStatus] = useState<string>(
    `${CLIPS.length} clip${CLIPS.length === 1 ? "" : "s"} in the project state.`,
  );

  const add = (clipId: string) => {
    const layerId = clipLayerId(clipId);
    const replacing = hasLayer(definition, layerId);
    const next = withClipLayer(definition, { clipId });
    writeDefinitionOverride(next);
    setDefinition(next);
    setStatus(`${replacing ? "Replaced" : "Added"} layer ${layerId} → reload /machine to play it.`);
  };

  const remove = (layerId: string) => {
    const next = withoutLayer(definition, layerId);
    writeDefinitionOverride(next);
    setDefinition(next);
    setStatus(`Removed layer ${layerId} → reload /machine.`);
  };

  const reset = () => {
    clearDefinitionOverride();
    setDefinition(loadMachineDefinition());
    setStatus("Back to the shipped definition → reload /machine.");
  };

  const download = () => {
    downloadDefinition(definition, DOWNLOAD_NAME);
    setStatus(`Downloaded ${DOWNLOAD_NAME} — move it into definitions/ to ship it.`);
  };

  /* The Studio toolbar is a toolbar, not a router; an anchor would be eaten by its shadow
     root's handlers, so the pane opens the page and says so. */
  const openPage = () => {
    window.open("/machine", "_blank", "noopener");
    setStatus("Opened /machine in a new tab.");
  };

  const mapped = Object.entries(THEATRE_BONE_MAP);

  return (
    <div className="astro-pane">
      <p className="astro-pane__title">Machine · timelines as layers</p>

      <p className="astro-pane__hint">
        Clips come from the exported Theatre state. Rig a scene on <code>/rig/&lt;scene&gt;</code>,
        press the Studio&apos;s Save, reload, then add it here.
      </p>

      <div className="astro-pane__row">
        <button type="button" onClick={openPage}>
          Open /machine
        </button>
        <button type="button" onClick={download}>
          Download definition
        </button>
        <button type="button" onClick={reset}>
          Reset to shipped
        </button>
      </div>

      <p className="astro-pane__title">Clips</p>
      {CLIPS.length === 0 ? (
        <p className="astro-pane__empty">
          The project state has no position, scale or rotation tracks.
        </p>
      ) : (
        <ul className="astro-pane__list">
          {CLIPS.map((clip) => (
            <li key={clip.id} className="astro-pane__row">
              <span className="astro-pane__shape">
                <span className="astro-pane__shape-kind">{clip.sheetId}</span>
                <span className="astro-pane__shape-key">{clip.objectKey}</span>
                <span className="astro-pane__hint">
                  {clip.duration.toFixed(2)}s · {formatChannels(clip.channels)} →{" "}
                  {THEATRE_BONE_MAP[clip.objectKey] ?? clip.objectKey}
                </span>
              </span>
              <button type="button" onClick={() => add(clip.id)}>
                {hasLayer(definition, clipLayerId(clip.id)) ? "Replace" : "Add as layer"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="astro-pane__title">Layers in the live definition</p>
      <ul className="astro-pane__list">
        {definition.layers.map((layer) => (
          <li key={layer.id} className="astro-pane__row">
            <span className="astro-pane__shape">
              <span className="astro-pane__shape-key">{layer.id}</span>
              <span className="astro-pane__hint">
                {layer.states
                  .map((state) => (state.type === "clip" ? state.clip : state.type))
                  .join(", ")}
              </span>
            </span>
            {layer.id.startsWith("clip.") && definition.layers.length > 1 ? (
              <button type="button" onClick={() => remove(layer.id)}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="astro-pane__status">{status}</p>

      <p className="astro-pane__hint">
        Bone map: {mapped.map(([object, bone]) => `${object} → ${bone}`).join(", ")}. Edit{" "}
        <code>THEATRE_BONE_MAP</code> in{" "}
        <code>presentation/canvas/machine/machineAuthoring.ts</code> to point a timeline at a
        different bone.
      </p>
    </div>
  );
}

/**
 * `PaneClassDefinition.mount`, mirroring the Scene Tools pane: stylesheet first (shadow DOM
 * blocks the app's CSS), then a container React owns, then a teardown that unmounts off the
 * Studio's own lifecycle.
 */
export function mountMachinePane(node: HTMLElement): () => void {
  const style = document.createElement("style");
  style.textContent = PANE_CSS;
  node.appendChild(style);

  const container = document.createElement("div");
  node.appendChild(container);

  const root: Root = createRoot(container);
  root.render(<MachinePane />);

  return () => {
    window.setTimeout(() => {
      root.unmount();
      container.remove();
      style.remove();
    }, 0);
  };
}
