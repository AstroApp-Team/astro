/**
 * The rig studio's frame: three columns, a graph, a split timeline, and every size draggable.
 *
 * The layout is CSS grid driven by three custom properties on the shell, so a splitter drag is
 * one store-free state write and the browser does the rest. That is deliberate: an absolutely
 * positioned panel resized per pointer-move re-lays-out a canvas every frame on a phone, and the
 * three panels here sit next to a WebGL viewport.
 *
 * The centre column is a *nested* grid (preview / graph / bottom) with its own splitters, which is
 * the one place the layout needs care: the graph must keep a minimum height, so its row is
 * `minmax(160px, 1fr)` and the preview and bottom rows are fixed px. Otherwise dragging the bottom
 * up eats the graph and then the canvas, and the person loses both while looking at a handle.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { IStudio } from "@theatre/studio";

import { isSceneId, type SceneId } from "@core/models/scene.ts";
import { SCENE_SHEET_IDS, getSheet } from "@infra/theatre/project.ts";
import { useSheetPlayback } from "@infra/theatre/useSheetPlayback.ts";
import MainCanvas from "@presentation/canvas/MainCanvas.tsx";
import { GraphCanvas, useGraphLayer } from "@presentation/ui/editor/graph/GraphCanvas.tsx";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

import { BottomPanel } from "./BottomPanel.tsx";
import { HeaderBar } from "./HeaderBar.tsx";
import { LeftPanel } from "./LeftPanel.tsx";
import { RightPanel } from "./RightPanel.tsx";
import { PROJECT_ID } from "@infra/theatre/states/index.ts";
import { objectKeys, sequenceLength } from "./theatreView.ts";
import { seedSceneMachine } from "./sceneMachine.ts";
import { listTheatreClips } from "@infra/theatre/animationStateMachine/theatreAssetResolver.ts";
import { Splitter, usePanelSizes } from "./usePanelLayout.tsx";

export function StudioShell({
  scene,
  studio,
  studioUi,
  studioAvailable,
  onToggleStudio,
}: {
  scene: SceneId;
  studio: IStudio | null;
  studioUi: boolean;
  studioAvailable: boolean;
  onToggleStudio: () => void;
}) {
  const navigate = useNavigate();
  const sheet = getSheet(SCENE_SHEET_IDS[scene]);
  const playback = useSheetPlayback(sheet);
  const definition = useEditorStore((state) => state.definition);
  const hydrate = useEditorStore((state) => state.hydrate);
  const layer = useGraphLayer();
  const selection = useEditorStore((state) => state.selection);
  const editingNode = selection?.kind === "state" || selection?.kind === "transition";
  const bindTimeline = useEditorStore((state) => state.bindTimeline);
  const insertTimeline = useEditorStore((state) => state.insertTimeline);
  const setStatus = useEditorStore((state) => state.setStatus);
  const { sizes, resize, reset } = usePanelSizes();
  const [status, setLocalStatus] = useState("");
  const refused = useEditorStore((state) => state.error);

  /*
   * A refused command used to be invisible: the store validates every draft and drops the ones the
   * loader would reject, recording why in `error`, and nothing rendered it. That is how "creating a
   * timeline does nothing" survived — the click ran, the write was rejected, and the page said
   * nothing at all.
   */
  useEffect(() => {
    if (refused == null || refused === "") return;
    setLocalStatus(`Refused: ${refused}`);
  }, [refused]);

  /*
   * The timeline reads the project's state, which changes when the Studio edits it. The revision
   * counter is the cheap subscription: Theatre has no public "state changed" event, and the
   * alternative is polling the whole state file on every frame.
   */
  /*
   * Inlined rather than a `useLiveStateRevision()` hook, and that is not a style choice: as a
   * custom hook, React's dev-mode hook-order check reported `StudioShell`'s hook list changing
   * between the first two renders (a `useState` where the previous render had an effect), and the
   * effect that followed crashed with `Cannot set properties of undefined (setting 'destroy')` —
   * the page rendered nothing at all. The same two hooks written here belong to this component and
   * cannot be re-ordered relative to its other hooks, and the polling body is a `useEffect` that
   * closes over `studio`, exactly like `liveStateRevision` did.
   */
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (studio == null) return;
    let last = "";
    const read = () => {
      try {
        const text = JSON.stringify(studio.createContentOfSaveFile(PROJECT_ID));
        if (text !== last) {
          last = text;
          let value = 2166136261;
          for (let index = 0; index < text.length; index += 1) {
            value ^= text.charCodeAt(index);
            value = Math.imul(value, 16777619);
          }
          setRevision(value >>> 0);
        }
      } catch {
        /* A transient read failure is not a state change; keep the last good revision. */
      }
    };
    read();
    const timer = setInterval(read, 750);
    return () => {
      clearInterval(timer);
    };
  }, [studio]);
  const sheetObjects = objectKeys(SCENE_SHEET_IDS[scene], studio);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /*
   * One machine per scene.
   *
   * The seeds are the sheet's own Theatre clips (`SheetId/ObjectKey` — the ids the resolver
   * reads), one state and one timeline each, so a freshly opened scene has a machine that plays
   * something real instead of an empty graph. `switchScene` stashes the outgoing scene's draft, so
   * moving the dropdown is not a discard.
   */
  const sheetId = SCENE_SHEET_IDS[scene];
  const switchScene = useEditorStore((state) => state.switchScene);
  useEffect(() => {
    const clips = listTheatreClips()
      .filter((clip) => clip.sheetId === sheetId)
      .map((clip) => ({
        objectKey: clip.objectKey,
        clip: clip.id,
        duration: clip.duration > 0 ? clip.duration : 1,
      }));
    switchScene(`${scene}:${sheetId}`, () =>
      seedSceneMachine(scene, clips, sequenceLength(sheetId, studio)),
    );
  }, [scene, sheetId, studio, switchScene]);

  useEffect(() => {
    /* `selectionVisuals` is per page, stated on mount — see the long note on `/showcase`. */
    useSceneStore.getState().setSelectionVisuals(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target != null && /input|textarea|select/i.test(target.tagName)) return;
      if (event.key === " ") {
        event.preventDefault();
        playback.play([0, Math.max(0.001, playback.length())]);
      }
      if (event.key === "Escape") useEditorStore.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [playback]);

  const report = (message: string) => {
    setLocalStatus(message);
    setStatus(message);
  };

  return (
    <div
      className="st-shell"
      style={{
        ["--st-left" as string]: `${String(sizes.left)}px`,
        ["--st-right" as string]: `${String(sizes.right)}px`,
        ["--st-preview" as string]: `${String(sizes.preview)}px`,
        ["--st-bottom" as string]: editingNode
          ? "clamp(300px, 42vh, 560px)"
          : `${String(sizes.bottom)}px`,
      }}
    >
      <HeaderBar
        scene={scene}
        playback={playback}
        studioUi={studioUi}
        studioAvailable={studioAvailable}
        onToggleStudio={onToggleStudio}
        onScene={(next) => {
          if (isSceneId(next)) navigate(`/rig/${next}`);
        }}
        status={status}
      />

      <div className="st-body">
        <aside className="st-column st-column--left" aria-label="Scene, timelines, machines">
          <LeftPanel
            scene={scene}
            sheetId={SCENE_SHEET_IDS[scene]}
            sheetObjects={sheetObjects}
            definition={definition}
            sequenceLength={playback.length()}
            onStatus={report}
          />
        </aside>
        <Splitter
          axis="x"
          label="Resize the left column"
          onResize={(delta) => {
            resize("left", delta);
          }}
          onDoubleClick={reset}
        />

        <main className="st-center">
          <div className="st-preview">
            <MainCanvas scene={scene} className="st-preview__canvas" />
            <span className="st-preview__badge">preview · {scene}</span>
          </div>
          <Splitter
            axis="y"
            label="Resize the preview"
            onResize={(delta) => {
              /*
               * This handle sits *below* the preview and above the graph, and it used to write
               * `bottom` — the deck. Dragging the preview's own edge moved a panel on the other
               * side of the graph, which is the report "when I grab the top of the canvas it
               * changes the panel below it". A handle must write the panel it borders on the
               * side the pointer is moving: grabbing the preview's bottom edge sizes the preview.
               */
              resize("preview", delta);
            }}
            onDoubleClick={reset}
          />
          <div
            className="st-graph"
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              /* The SVG handles its own drop (it knows its transform); this is the fallback for a
                 drop that lands on the gap around it. */
              if ((event.target as Element).closest(".ed-graph") != null) return;
              const timelineId =
                event.dataTransfer.getData("text/x-astro-timeline") ||
                event.dataTransfer.getData("text/plain");
              if (timelineId === "" || layer == null) return;
              bindTimeline(layer.id, timelineId, null);
              report(`Added a state for ${timelineId}`);
            }}
          >
            {layer == null ? (
              <p className="ed-empty">This machine has no layers yet.</p>
            ) : (
              <GraphCanvas
                /*
                 * No `key` on the revision. A key here remounted the graph on every Studio write
                 * (and every poll tick of it), and a remount re-runs the initial "fit the layer"
                 * effect — which is why a pan snapped back to the fitted view a beat after the
                 * drag ended, and why dragging felt like the canvas was fighting back. The card
                 * labels come from `definition`, so a repaint is not needed at all.
                 */
                layer={layer}
                onTimelineDrop={(timelineId, target) => {
                  if (target.kind === "state") {
                    bindTimeline(layer.id, timelineId, target.stateId);
                    report(`Bound ${timelineId} to ${target.stateId}`);
                    return;
                  }
                  if (target.kind === "transition") {
                    insertTimeline(
                      layer.id,
                      timelineId,
                      target.from,
                      target.to,
                      target.index,
                      target.anyState,
                    );
                    report(`Inserted ${timelineId} into ${target.from} → ${target.to}`);
                    return;
                  }
                  bindTimeline(layer.id, timelineId, null);
                  report(`Added a state for ${timelineId}`);
                }}
              />
            )}
          </div>
          <Splitter
            axis="y"
            label="Resize the dope sheet"
            onResize={(delta) => {
              /* The box below the handle is the deck: dragging its top edge grows it upward. */
              resize("bottom", -delta);
            }}
            onDoubleClick={reset}
          />
          <div className="st-bottom-wrap">
            <BottomPanel
              definition={definition}
              sheet={sheet}
              sheetId={SCENE_SHEET_IDS[scene]}
              studio={studio}
              sequenceLength={playback.length()}
              revision={revision}
              onStatus={report}
            />
          </div>
        </main>

        <Splitter
          axis="x"
          label="Resize the right column"
          onResize={(delta) => {
            resize("right", -delta);
          }}
          onDoubleClick={reset}
        />
        <aside className="st-column st-column--right" aria-label="Properties and tools">
          <RightPanel
            sheet={sheet}
            sheetId={SCENE_SHEET_IDS[scene]}
            studio={studio}
            sequenceLength={playback.length()}
            definition={definition}
            onStatus={report}
          />
        </aside>
      </div>
    </div>
  );
}
