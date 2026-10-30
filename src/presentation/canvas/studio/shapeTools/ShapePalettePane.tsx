import { createRoot, type Root } from "react-dom/client";
import { useRef, useState } from "react";
import type { IStudio } from "@theatre/studio";

import { SHAPE_MENU } from "@core/models/shapes.ts";
import { eulerToDegrees } from "@infra/theatre/cameraAim.ts";
import { SHEET_IDS, type SheetId } from "@infra/theatre/project.ts";
import {
  aimCameraAt,
  aimCameraAtShapeId,
  resetCameraRotation,
} from "@presentation/canvas/studio/shapeTools/aimService.ts";
import { openShapeMenuFromElement } from "@presentation/canvas/studio/shapeTools/shapeMenuController.tsx";
import {
  clearStudioSave,
  describeSave,
  isStudioSaveAvailable,
  saveStudioToDisk,
  STUDIO_SAVE_FILES,
} from "@presentation/canvas/studio/shapeTools/saveService.ts";
import { PANE_CSS } from "@presentation/canvas/studio/shapeTools/paneStyles.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

/**
 * The Scene Tools pane — the same two tools as the toolbar, in a dockable panel
 * with the state they produce visible.
 *
 * It is a "compact toolbar acting as a pane": the toolbar buttons are one-shot
 * (spawn, aim), while this shows the list they mutate, the `theatreKey` each
 * shape registered under, the camera key being rotated, the sheet being acted
 * on, and the Euler that was written. When a tool "does nothing", the pane says
 * why, in the same words the toolbar status line uses.
 *
 * The pane is a *consumer* of `useShapeStore`, exactly like the toolbar. It owns
 * no scene state of its own, so a pane opened, closed and reopened mid-rig shows
 * the same shapes the canvas is rendering.
 */
export default function ShapePalettePane({ studio, paneId }: { studio: IStudio; paneId: string }) {
  const shapes = useShapeStore((state) => state.shapes);
  const sheetId = useShapeStore((state) => state.sheetId);
  const cameraKey = useShapeStore((state) => state.cameraKey);
  const lastAim = useShapeStore((state) => state.lastAim);
  const toolStatus = useShapeStore((state) => state.toolStatus);
  const lastSavedAt = useShapeStore((state) => state.lastSavedAt);
  const addShape = useShapeStore((state) => state.addShape);
  const removeShape = useShapeStore((state) => state.removeShape);
  const clearShapes = useShapeStore((state) => state.clearShapes);
  const setSheetId = useShapeStore((state) => state.setSheetId);
  const setCameraKey = useShapeStore((state) => state.setCameraKey);
  const setToolStatus = useShapeStore((state) => state.setToolStatus);
  const setLastSavedAt = useShapeStore((state) => state.setLastSavedAt);

  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [saving, setSaving] = useState(false);

  const runAim = (targetKey: string | null) => {
    const outcome = aimCameraAt(studio, targetKey);
    if (!outcome.ok) setToolStatus(outcome.reason);
  };

  /**
   * Write the rig to disk.
   *
   * `saving` is local component state, not store state: it exists to disable the
   * buttons for the length of one request, and nothing outside this pane reads it.
   * What the request *means* — the timestamp, the reason it failed — goes in the
   * store, where the toolbar and the flyout print the same words.
   */
  const runSave = () => {
    setSaving(true);
    setToolStatus("Saving to disk…");
    void saveStudioToDisk(studio).then((outcome) => {
      setSaving(false);
      if (outcome.ok) setLastSavedAt(outcome.savedAt);
      setToolStatus(describeSave(outcome));
    });
  };

  const runClear = () => {
    setSaving(true);
    setToolStatus("Clearing the saved files…");
    void clearStudioSave().then((outcome) => {
      setSaving(false);
      if (outcome.ok) setLastSavedAt(null);
      setToolStatus(describeSave(outcome));
    });
  };

  return (
    <div className="astro-pane">
      <div className="astro-pane__title">
        <span>Scene Tools</span>
        <code>{paneId}</code>
      </div>

      <div className="astro-pane__row">
        <button
          type="button"
          ref={menuButtonRef}
          onClick={() => {
            const anchor = menuButtonRef.current;
            if (anchor == null) return;
            openShapeMenuFromElement(anchor, addShape);
          }}
        >
          Add Shape ▾
        </button>
        {SHAPE_MENU.map((spec) => (
          <button
            key={spec.kind}
            type="button"
            title={`Spawn ${spec.label}`}
            onClick={() => addShape(spec.kind)}
          >
            {spec.label}
          </button>
        ))}
      </div>

      <div className="astro-pane__row">
        <button type="button" onClick={() => runAim(null)}>
          Aim Camera
        </button>
        <button
          type="button"
          onClick={() => {
            const outcome = resetCameraRotation(studio);
            if (!outcome.ok) setToolStatus(outcome.reason);
          }}
        >
          Reset rotation
        </button>
        <button type="button" onClick={clearShapes} disabled={shapes.length === 0}>
          Clear shapes
        </button>
      </div>

      <div className="astro-pane__row">
        <button
          type="button"
          onClick={runSave}
          disabled={saving || !isStudioSaveAvailable}
          title={`Write ${STUDIO_SAVE_FILES.state} and ${STUDIO_SAVE_FILES.shapes}`}
        >
          {saving ? "Saving…" : "Save to disk"}
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          title="Re-read the files on disk, hand-edits included"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={runClear}
          disabled={saving || !isStudioSaveAvailable}
          title="Empty both files. The shapes on screen stay put until you reload."
        >
          Clear files
        </button>
      </div>

      <div className="astro-pane__row">
        <label className="astro-pane__field">
          Sheet
          <select value={sheetId} onChange={(event) => setSheetId(event.target.value as SheetId)}>
            {Object.values(SHEET_IDS).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="astro-pane__field">
          Camera key
          <input
            value={cameraKey}
            spellCheck={false}
            onChange={(event) => setCameraKey(event.target.value)}
          />
        </label>
      </div>

      {shapes.length === 0 ? (
        <p className="astro-pane__empty">
          No spawned shapes. Add one and it lands in the outliner.
        </p>
      ) : (
        <ul className="astro-pane__list">
          {shapes.map((shape) => (
            <li key={shape.id} className="astro-pane__shape">
              <span>
                <span className="astro-pane__shape-kind">{shape.kind}</span>{" "}
                <span className="astro-pane__shape-key">{shape.theatreKey}</span>
              </span>
              <button
                type="button"
                title="Rotate the camera onto this shape"
                onClick={() => {
                  const outcome = aimCameraAtShapeId(studio, shape.id);
                  if (!outcome.ok) setToolStatus(outcome.reason);
                }}
              >
                Aim
              </button>
              <button
                type="button"
                title="Remove from the scene"
                onClick={() => removeShape(shape.id)}
              >
                Del
              </button>
            </li>
          ))}
        </ul>
      )}

      {lastAim == null ? null : (
        <p className="astro-pane__status">
          rotation →{" "}
          {eulerToDegrees(lastAim.euler)
            .map((deg) => `${deg}°`)
            .join("  ")}{" "}
          on {lastAim.cameraKey}
        </p>
      )}

      <p className="astro-pane__status">{toolStatus}</p>

      <p className="astro-pane__hint">
        {lastSavedAt == null ? "Nothing saved in this session." : `Last saved ${lastSavedAt}.`}{" "}
        Hand-edit <code>{STUDIO_SAVE_FILES.shapes}</code> and press Reload to spawn shapes from the
        file; edit <code>{STUDIO_SAVE_FILES.state}</code> for the keyframes.
      </p>
    </div>
  );
}

/**
 * The `PaneClassDefinition.mount` implementation.
 *
 * The Studio hands over a raw `HTMLElement` inside its shadow root and expects a
 * teardown function back. Three things happen here, in this order, and each one
 * is here for a specific failure it prevents:
 *
 *   1. the stylesheet goes in first, inside the pane's own node — shadow DOM
 *      blocks the app's CSS, see `paneStyles.ts`;
 *   2. a dedicated container div, so React owns a node the Studio will not
 *      re-render underneath it;
 *   3. the teardown unmounts on a timeout. React 18+ warns when `unmount()` runs
 *      synchronously inside a React lifecycle, and the Studio calls this cleanup
 *      from inside its own.
 */
export function mountShapePalettePane(
  node: HTMLElement,
  studio: IStudio,
  paneId: string,
): () => void {
  const style = document.createElement("style");
  style.textContent = PANE_CSS;
  node.appendChild(style);

  const container = document.createElement("div");
  node.appendChild(container);

  const root: Root = createRoot(container);
  root.render(<ShapePalettePane studio={studio} paneId={paneId} />);

  return () => {
    window.setTimeout(() => {
      root.unmount();
      container.remove();
      style.remove();
    }, 0);
  };
}
