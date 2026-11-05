/**
 * The split below the graph: the sheet's dope sheet on top, the selected state/transition's editor
 * below.
 *
 * Both halves are live at once, because the two questions are asked together: "where is this
 * keyframe" and "what does this state do". Selecting a state or a transition opens the lower half
 * (the graph click is the intent); the tab row can collapse it again without deselecting, and the
 * divider between them is draggable so either half can take the deck.
 *
 * The selection editor is the *same* `Inspector` the `/editor` route uses. That is the point of
 * sharing it: a field added to the machine's inspector appears here, and there is no second
 * implementation to drift.
 */

import { useRef, useState } from "react";

import type { IStudio } from "@theatre/studio";
import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { Inspector } from "@presentation/ui/editor/inspector/Inspector.tsx";

import type { ISheet } from "./theatreView.ts";
import { StudioTimeline } from "./StudioTimeline.tsx";

export function BottomPanel({
  definition,
  sheet,
  sheetId,
  studio,
  sequenceLength,
  revision,
  onStatus,
}: {
  definition: MachineDefinition;
  sheet: ISheet;
  sheetId: string;
  studio: IStudio | null;
  sequenceLength: number;
  /** Changes when the Studio writes the state file; the timeline is read from that file. */
  revision: number;
  onStatus: (message: string) => void;
}) {
  const selection = useEditorStore((state) => state.selection);
  const isNodeSelection = selection?.kind === "state" || selection?.kind === "transition";
  const [tab, setTab] = useState<"timeline" | "selection">("timeline");
  const [ratio, setRatio] = useState(0.56);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /* A node selection is what the lower half is for, so selecting one opens it. */
  const editing = isNodeSelection && tab === "timeline";
  const active = editing ? "selection" : tab;

  /**
   * Drag the divider. `setPointerCapture` keeps the events coming after the pointer leaves the
   * 4px strip, which is the difference between a usable handle and one that stops mid-drag.
   */
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (body == null) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const rect = body.getBoundingClientRect();
      if (rect.height === 0) return;
      const next = (moveEvent.clientY - rect.top) / rect.height;
      setRatio(Math.min(0.85, Math.max(0.2, next)));
    };
    const end = () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", end);
      globalThis.removeEventListener("pointercancel", end);
    };

    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", end);
    globalThis.addEventListener("pointercancel", end);
  };

  return (
    <div className="st-bottom">
      <div className="st-bottom__tabs">
        <button
          type="button"
          className="ed-tab"
          data-active={active === "timeline"}
          onClick={() => {
            setTab("timeline");
          }}
        >
          Dope Sheet
        </button>
        <button
          type="button"
          className="ed-tab"
          data-active={active === "selection"}
          disabled={!isNodeSelection}
          onClick={() => {
            setTab("selection");
          }}
        >
          {selection?.kind === "transition"
            ? `Transition · ${selection.from} → ${selection.to}`
            : selection?.kind === "state"
              ? `State · ${selection.state}`
              : "Selection"}
        </button>
        {selection == null ? null : (
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            title="Clear the selection"
            onClick={() => {
              useEditorStore.getState().select(null);
            }}
          >
            ✕
          </button>
        )}
        <span className="st-header__status">
          {isNodeSelection ? "" : "select a state to edit it"}
        </span>
      </div>

      <div
        ref={bodyRef}
        className="st-bottom__body"
        style={
          editing
            ? { gridTemplateRows: `minmax(0, ${ratio}fr) 4px minmax(0, ${1 - ratio}fr)` }
            : undefined
        }
      >
        <div className="st-bottom__pane">
          <StudioTimeline
            key={revision}
            sheet={sheet}
            sheetId={sheetId}
            studio={studio}
            sequenceLength={sequenceLength}
            onStatus={onStatus}
          />
        </div>

        {editing ? (
          <>
            <hr
              className="st-split st-split--y"
              aria-label="Resize the editor"
              onPointerDown={startDrag}
            />
            <div className="st-bottom__pane">
              <Inspector definition={definition} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
