/**
 * The editor shell: four zones, one document, one keyboard owner.
 *
 * The zones are the spec's (§2): header, sidebar, viewport + stage, inspector, with the
 * timeline pinned under the stage. The layout is a CSS grid whose two side tracks come from
 * the editor file, so a wider inspector survives a reload — and a reload is the only thing
 * that can lose a split, because there is no second store for it.
 *
 * Two behaviours are worth reading before changing anything here:
 *
 * - **The preview rebuilds when the draft changes, except while playing.** `createMachine` has
 *   no hot-swap, so a new definition is a new machine. A structural edit while paused just
 *   rebuilds; a *numeric* edit while playing is held back until the author pauses, and the
 *   header says the preview is behind rather than silently resetting a test run (§4.5).
 * - **The selection is mirrored into the query string, never read from it after mount.** A
 *   click writes it; the browser's back button is not a selection gesture here.
 */

import { useEffect, useRef, useState } from "react";

import type { LayerDef, MachineDefinition } from "@core/models/animationStateMachine.ts";
import type { Selection } from "@core/models/animationStateMachineEditor.ts";
import {
  decodeSelection,
  encodeSelection,
} from "@core/usecases/animationStateMachine/editorSelection.ts";
import { clipIdOf } from "@core/usecases/animationStateMachine/editorOps.ts";
import { structuralHash } from "@core/usecases/animationStateMachine/structuralHash.ts";
import { validateDefinition } from "@core/usecases/animationStateMachine/validateDefinition.ts";
import { ensureStudio, hideStudioUi, showStudioUi } from "@infra/theatre/studioInit.ts";
import { machineResolver } from "@presentation/canvas/machine/machineAuthoring.ts";
import { PreviewCanvas } from "@presentation/ui/editor/PreviewCanvas.tsx";
import { useAnimationMachine } from "@presentation/canvas/machine/useAnimationMachine.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useMachineStore } from "@presentation/state/useMachineStore.ts";
import { GraphCanvas, useGraphLayer } from "@presentation/ui/editor/graph/GraphCanvas.tsx";
import { Header } from "@presentation/ui/editor/header/Header.tsx";
import { Inspector } from "@presentation/ui/editor/inspector/Inspector.tsx";
import { Sidebar } from "@presentation/ui/editor/sidebar/Sidebar.tsx";
import { Timeline } from "@presentation/ui/editor/timeline/Timeline.tsx";

import "@presentation/ui/editor/editor.css";

const RESOLVER = machineResolver();

/* Module scope so the preview hook's dependency is stable: a resolver built per render would
   be a new object every frame, and `useAnimationMachine` rebuilds on identity. */
function PreviewViewport({ definition }: { definition: MachineDefinition }) {
  const playing = useEditorStore((store) => store.playing);
  const viewportMode = useEditorStore((store) => store.viewportMode);
  const layers = definition.layers.map((layer) => layer.id);

  const handle = useAnimationMachine({
    definition,
    resolver: RESOLVER,
    seed: 7,
    onMachine: () => {
      /* A rebuild must not leave the telemetry lane showing a layer the new definition has
         dropped: the store is cleared here, not on unmount, because the machine's identity is
         what changed. */
      useMachineStore.getState().clear();
    },
  });

  /* Belt and braces: `apply` refuses invalid drafts, but a definition handed in from outside
     (a stale draft, a hand-edited file) must not take the shell down with it. */
  const report = validateDefinition(definition);
  if (!report.ok) {
    return (
      <div className="ed-preview" data-mode={viewportMode}>
        <p className="ed-preview__error">
          The draft does not load: {report.errors[0]?.path} — {report.errors[0]?.message}
        </p>
      </div>
    );
  }

  return (
    <div className="ed-preview" data-mode={viewportMode}>
      <PreviewCanvas
        handle={handle}
        layers={layers}
        playing={playing && viewportMode !== "stopped"}
      />
      <div className="ed-preview__badge">machine</div>
    </div>
  );
}

function Stage({
  definition,
  layer,
  selection,
}: {
  definition: MachineDefinition;
  layer: LayerDef;
  selection: Selection;
}) {
  const mode = useEditorStore((store) => store.mode);
  const table = useEditorStore((store) => store.table);
  const setTable = useEditorStore((store) => store.setTable);
  const addState = useEditorStore((store) => store.addState);

  return (
    <div className="ed-stage" data-mode={mode}>
      <div className="ed-stage__graph">
        {table ? (
          <table className="ed-table">
            <thead>
              <tr>
                <th>state</th>
                <th>type</th>
                <th>clip</th>
              </tr>
            </thead>
            <tbody>
              {layer.states.map((state) => (
                <tr key={state.id}>
                  <td>{state.id}</td>
                  <td>{state.type}</td>
                  <td>{("timeline" in state ? state.timeline : null) ?? clipIdOf(state) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <GraphCanvas layer={layer} />
        )}
      </div>
      <div className="ed-stage__tools">
        <button
          type="button"
          className="ed-btn ed-btn--ghost"
          onClick={() => addState(layer.id)}
          title="Add a clip state to this layer"
        >
          + state
        </button>
        <button
          type="button"
          className="ed-btn ed-btn--ghost"
          onClick={() => setTable(!table)}
          title="The read-only table alternative"
        >
          {table ? "graph" : "table"}
        </button>
      </div>
      <Timeline definition={definition} layer={layer} selection={selection} />
    </div>
  );
}

export function EditorApp() {
  const definition = useEditorStore((store) => store.definition);
  const selection = useEditorStore((store) => store.selection);
  const selects = useEditorStore((store) => store.select);
  const mode = useEditorStore((store) => store.mode);
  const setMode = useEditorStore((store) => store.setMode);
  const playing = useEditorStore((store) => store.playing);
  const setPlaying = useEditorStore((store) => store.setPlaying);
  const dirty = useEditorStore((store) => store.dirty);
  const splits = useEditorStore((store) => store.file.splits);
  const setSplits = useEditorStore((store) => store.setSplits);
  const undo = useEditorStore((store) => store.undo);
  const redo = useEditorStore((store) => store.redo);
  const save = useEditorStore((store) => store.save);
  const removeState = useEditorStore((store) => store.removeState);

  /* The Studio panel is hidden for this route: it covers the header and the inspector, and
     this page has no rig to edit — the machine's numbers are the document. */
  useEffect(() => {
    let cancelled = false;
    let restoreAfterUnmount = false;
    void ensureStudio().then((studio) => {
      if (cancelled || studio == null) return;
      restoreAfterUnmount = !studio.ui.isHidden;
      hideStudioUi();
    });
    return () => {
      cancelled = true;
      if (restoreAfterUnmount) showStudioUi();
    };
  }, []);

  const hydrate = useEditorStore((store) => store.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const layer = useGraphLayer();
  const [preview, setPreview] = useState(definition);
  const [behind, setBehind] = useState(false);
  const structure = structuralHash(definition);
  const previewStructure = useRef(structure);
  const adopted = useRef(definition);
  const shell = useRef<HTMLDivElement | null>(null);

  /* A new shape is a new machine whether or not it is playing; a numeric edit waits for the
     pause, so live tuning cannot yank the state out from under a test. */
  useEffect(() => {
    const changedShape = previewStructure.current !== structure;
    /* Paused: adopt at once, so the viewport shows what the inspector says. Playing: adopt a
       new *shape* (the old machine cannot play it), but hold a numeric edit back — and only
       call it "behind" when the draft really is a different object, or pressing play would
       raise the banner on an unchanged definition. */
    if (!playing || changedShape) {
      previewStructure.current = structure;
      adopted.current = definition;
      setPreview(definition);
      setBehind(false);
      return;
    }
    if (adopted.current !== definition) setBehind(true);
  }, [structure, playing, definition]);

  /* Selection ⇄ URL, one direction each: mounted once from the URL, written on every change. */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const url = new URL(globalThis.location.href);
    const decoded = decodeSelection(url.searchParams.get("sel"));
    if (decoded != null) selects(decoded);
  }, [selects]);

  useEffect(() => {
    const url = new URL(globalThis.location.href);
    const encoded = encodeSelection(selection);
    if (encoded == null) url.searchParams.delete("sel");
    else url.searchParams.set("sel", encoded);
    globalThis.history.replaceState(null, "", url);
  }, [selection]);

  /* Leaving with unsaved edits is the one destructive action the editor can take. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Unsaved machine edits";
      return "Unsaved machine edits";
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target != null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (typing) return;
      if (event.key === " " && !mod) {
        event.preventDefault();
        setPlaying(!useEditorStore.getState().playing);
      } else if (event.key === "Escape") {
        selects(null);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        const current = useEditorStore.getState().selection;
        if (current?.kind === "state") removeState(current.layer, current.state);
      } else if (event.key === "1") setMode("graph");
      else if (event.key === "2") setMode("timeline");
      else if (event.key === "3") setMode("split");
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [redo, removeState, save, selects, setMode, setPlaying, undo]);

  /* Splitter: one pointer capture, one number, no layout thrash while dragging. */
  const dragSplit = (side: "sidebar" | "inspector") => (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const start = splits[side];
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.min(560, Math.max(200, start + (side === "sidebar" ? delta : -delta)));
      setSplits({ [side]: next });
    };
    const up = () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", up);
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", up);
  };

  const selectionLayer =
    selection?.kind === "state" || selection?.kind === "transition" ? selection.layer : null;
  const shownLayer = definition.layers.find((row) => row.id === selectionLayer) ?? layer;

  return (
    <div
      ref={shell}
      className="ed-shell"
      style={
        {
          "--ed-sidebar": `${String(splits.sidebar)}px`,
          "--ed-inspector": `${String(splits.inspector)}px`,
        } as React.CSSProperties
      }
    >
      <div className="ed-top">
        <Header definition={definition} />
        {behind ? (
          <output className="ed-behind">
            Preview is behind the draft — pause to apply the numeric edits.
            <button
              type="button"
              className="ed-btn ed-btn--ghost"
              onClick={() => {
                setPlaying(false);
                setPreview(definition);
                setBehind(false);
              }}
            >
              Apply now
            </button>
          </output>
        ) : null}
      </div>
      <main className="ed-main" data-mode={mode}>
        <Sidebar definition={definition} />
        <hr
          className="ed-split"
          aria-label="Resize the sidebar"
          onPointerDown={dragSplit("sidebar")}
        />
        <div className="ed-center">
          <PreviewViewport definition={preview} />
          <Stage definition={definition} layer={shownLayer} selection={selection} />
        </div>
        <hr
          className="ed-split"
          aria-label="Resize the inspector"
          onPointerDown={dragSplit("inspector")}
        />
        <div className="ed-inspector" data-open={selection != null ? "true" : undefined}>
          <button
            type="button"
            className="ed-inspector__close"
            aria-label="Close the inspector"
            onClick={() => selects(null)}
          >
            ✕
          </button>
          <Inspector definition={definition} />
        </div>
      </main>
      <footer className="ed-footer">
        <span className="ed-mono">
          {definition.layers.length}L · {definition.inputs.length}I ·{" "}
          {definition.layers.reduce((total, row) => total + row.states.length, 0)}S ·{" "}
          {definition.layers.reduce(
            (total, row) => total + row.transitions.length + row.anyState.length,
            0,
          )}
          E
        </span>
        <span className="ed-empty">Space play · Del delete · ⌘S save · ⌘Z undo · 1/2/3 stage</span>
      </footer>
    </div>
  );
}
