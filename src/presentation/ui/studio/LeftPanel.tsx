/**
 * The left column: what is in the scene, what timelines exist, which machine you are editing.
 *
 * Three sections, one per question an author asks before touching the graph, and they are
 * ordered by that question: *which object* (hierarchy → selects, and the right panel follows),
 * *which animation* (timelines → drag onto the graph), *which machine* (layers → switches the
 * canvas). A flat outliner would put all three in one list and make the drag ambiguous: the panel
 * would not know whether a row is something you select or something you drop.
 *
 * Drag payloads are plain `dataTransfer` strings, deliberately: the graph is an SVG that does its
 * own hit-testing, so a typed MIME (`text/x-astro-timeline`) is the one interface both sides can
 * read without sharing React state. `text/plain` carries the same id as a fallback for browsers
 * that strip custom types mid-drag.
 */

import { type DragEvent, useState } from "react";

import type { MachineDefinition, TimelineDef } from "@core/models/animationStateMachine.ts";
import { listTheatreClips } from "@infra/theatre/animationStateMachine/theatreAssetResolver.ts";
import { SCENE_NODES, type SceneId } from "@core/models/scene.ts";
import { type MachineEntry, useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { seedSceneMachine } from "./sceneMachine.ts";

export const TIMELINE_MIME = "text/x-astro-timeline";

/*
 * A module constant, not `?? []`.
 *
 * `useEditorStore((state) => state.machines[key] ?? [])` builds a new array on every store read,
 * so `useSyncExternalStore` never sees the same snapshot twice: React logs "The result of
 * getSnapshot should be cached to avoid an infinite loop" and the component's subscription
 * wedges — rows stop appearing after an edit, which reads as "the + does nothing".
 */
const NO_MACHINES: MachineEntry[] = [];

export function dragTimeline(event: DragEvent, timelineId: string) {
  /*
   * A `dragstart` without a `dataTransfer` is possible — a synthesized event (tests, a11y tools)
   * has none — and `setData` on `undefined` throws inside the handler, which cancels the drag with
   * an error that names nothing useful. The payload is a convenience: the canvas also accepts a
   * drop with only the timeline id in `text/plain`.
   */
  const transfer = event.dataTransfer;
  if (transfer == null) return;
  transfer.setData(TIMELINE_MIME, timelineId);
  transfer.setData("text/plain", timelineId);
  transfer.effectAllowed = "copy";
}

export function readTimelineDrop(event: DragEvent): string | null {
  const transfer = event.dataTransfer;
  if (transfer == null) return null;
  const value = transfer.getData(TIMELINE_MIME) || transfer.getData("text/plain");
  return value === "" ? null : value;
}

export function LeftPanel({
  scene,
  sheetId,
  sheetObjects,
  definition,
  sequenceLength,
  onStatus,
}: {
  scene: SceneId;
  sheetId: string;
  sheetObjects: string[];
  definition: MachineDefinition;
  /** The sheet's sequence length, used to size a newly-created machine's default timeline. */
  sequenceLength: number;
  onStatus: (message: string) => void;
}) {
  const selectedNode = useSceneStore((state) => state.selectedNodeId);
  const selectNode = useSceneStore((state) => state.selectNode);
  const activeLayer = useEditorStore((state) => state.file.debug.selectedLayer);
  const setDebug = useEditorStore((state) => state.setDebug);
  const addTimeline = useEditorStore((state) => state.addTimeline);
  const bindTimeline = useEditorStore((state) => state.bindTimeline);
  const removeTimeline = useEditorStore((state) => state.removeTimeline);
  const addLayer = useEditorStore((state) => state.addLayer);
  const removeLayer = useEditorStore((state) => state.removeLayer);
  const machines = useEditorStore((state) => state.machines[`${scene}:${sheetId}`] ?? NO_MACHINES);
  const machineId = useEditorStore((state) => state.machineId);
  const newMachine = useEditorStore((state) => state.newMachine);
  const selectMachine = useEditorStore((state) => state.selectMachine);
  const deleteMachine = useEditorStore((state) => state.deleteMachine);
  const clips = listTheatreClips(sheetId).map((clip) => ({
    objectKey: clip.objectKey,
    clip: clip.id,
    duration: clip.duration,
  }));
  const setStatus = useEditorStore((state) => state.setStatus);
  const addInput = useEditorStore((state) => state.addInput);
  const patchInput = useEditorStore((state) => state.patchInput);
  const removeInput = useEditorStore((state) => state.removeInput);

  const nodes = SCENE_NODES[scene];
  const timelines = definition.timelines ?? [];
  const layer = definition.layers.find((row) => row.id === activeLayer) ?? definition.layers[0];

  return (
    <div className="st-left">
      <section className="st-section">
        <h3 className="st-section__title">
          Scene objects
          <span className="st-section__count">{sheetId}</span>
        </h3>
        <ul className="st-list">
          {nodes.map((node) => (
            <li key={node.theatreKey}>
              <button
                type="button"
                className="st-row"
                data-active={selectedNode === node.theatreKey}
                title={`${node.label} — selects it and opens its properties`}
                onClick={() => {
                  selectNode(node.theatreKey);
                }}
              >
                <span className="st-dot" />
                <span className="st-row__label">{node.theatreKey}</span>
                <span className="st-row__meta">{node.status}</span>
              </button>
            </li>
          ))}
          {sheetObjects
            .filter((key) => !nodes.some((node) => node.theatreKey === key))
            .map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="st-row"
                  data-active={selectedNode === key}
                  title="A sheet object with tracks but no scene node (camera, light)"
                  onClick={() => {
                    selectNode(key);
                  }}
                >
                  <span className="st-dot" data-kind="sheet" />
                  <span className="st-row__label">{key}</span>
                  <span className="st-row__meta">sheet</span>
                </button>
              </li>
            ))}
        </ul>
        {nodes.length === 0 && sheetObjects.length === 0 ? (
          <p className="ed-empty">Nothing mounted on this scene.</p>
        ) : null}
      </section>

      <section className="st-section">
        <h3 className="st-section__title">
          Inputs
          <button
            type="button"
            className="st-icon"
            title="Add a number input the runtime can drive (mouseX, speed, mood…)"
            onClick={() => {
              let ordinal = definition.inputs.length + 1;
              while (definition.inputs.some((row) => row.name === `input${String(ordinal)}`)) {
                ordinal += 1;
              }
              void ordinal;
              addInput("number");
              setStatus("Added an input — name it, then drive it from a state or a transition.");
            }}
          >
            +
          </button>
        </h3>
        <ul className="st-list">
          {definition.inputs.map((input) => (
            <li key={input.name}>
              <div className="st-row" data-open="true">
                <input
                  className="ed-input st-row__name"
                  value={input.name}
                  title="The name the program binds to"
                  onChange={(event) => {
                    const next = event.target.value.trim();
                    if (next === "" || next === input.name) return;
                    /* Rename through the store so every condition that names it moves with it. */
                    patchInput(input.name, { name: next });
                  }}
                />
                <span className="st-row__meta">{input.kind}</span>
                <button
                  type="button"
                  className="st-row__action"
                  title="Delete this input"
                  onClick={() => {
                    removeInput(input.name);
                  }}
                >
                  ✕
                </button>
              </div>
              {input.kind === "number" ? (
                <div className="st-rowbody">
                  <label className="st-field">
                    <span>default</span>
                    <input
                      className="ed-input st-field__input"
                      type="number"
                      step="0.01"
                      value={Number(input.default.toFixed(3))}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        patchInput(input.name, { default: next });
                      }}
                    />
                  </label>
                  <label className="st-field">
                    <span>min</span>
                    <input
                      className="ed-input st-field__input"
                      type="number"
                      step="0.01"
                      value={Number((input.min ?? 0).toFixed(2))}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        patchInput(input.name, { min: next });
                      }}
                    />
                  </label>
                  <label className="st-field">
                    <span>max</span>
                    <input
                      className="ed-input st-field__input"
                      type="number"
                      step="0.01"
                      value={Number((input.max ?? 1).toFixed(2))}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        patchInput(input.name, { max: next });
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {definition.inputs.length === 0 ? (
          <p className="ed-empty">
            Press + to declare one. A clip or blend can then read it, and the app binds the value at
            runtime.
          </p>
        ) : null}
      </section>

      <section className="st-section">
        <h3 className="st-section__title">
          Timelines
          <button
            type="button"
            className="st-icon"
            title="Create a timeline from the selected object"
            onClick={() => {
              /*
               * Seed the clip from the scene's own sheet. A timeline with no `clip` is a row that
               * drags into the graph and then plays nothing — the exact "it created the icon and
               * nothing happened" report. The first Theatre clip of this sheet is a real
               * `SheetId/ObjectKey` the resolver can read, so the new row is immediately playable
               * and re-pointable in the inspector.
               */
              const seed = listTheatreClips().find((clip) => clip.sheetId === sheetId);
              const id = addTimeline({
                duration: Math.max(0.5, seed?.duration ?? sheetLengthHint(definition)),
                ...(seed == null ? {} : { clip: seed.id }),
              });
              setStatus(`Created ${id} — drag it onto the machine canvas.`);
              onStatus(`Created timeline ${id}`);
            }}
          >
            +
          </button>
        </h3>
        <ul className="st-list">
          {timelines.map((timeline) => (
            <TimelineRow
              key={timeline.id}
              timeline={timeline}
              layerId={layer?.id ?? "base"}
              selectedObject={selectedNode}
              onDelete={() => {
                const result = removeTimeline(timeline.id);
                if (!result.ok) {
                  setStatus(result.reason ?? "Could not delete that timeline.");
                  onStatus(result.reason ?? "Could not delete that timeline.");
                }
              }}
              onMakeState={() => {
                const stateId = bindTimeline(layer?.id ?? "base", timeline.id, null);
                setStatus(
                  stateId == null
                    ? `Could not bind ${timeline.id}.`
                    : `Added state ${stateId} playing ${timeline.id}`,
                );
              }}
              onStatus={onStatus}
            />
          ))}
        </ul>
        {timelines.length === 0 ? (
          <p className="ed-empty">No timelines yet — press + to author one.</p>
        ) : null}
      </section>

      <section className="st-section">
        <h3 className="st-section__title">
          State machines
          <button
            type="button"
            className="st-icon"
            title="New state machine for this scene"
            onClick={() => {
              /*
               * A machine is a *whole definition*, not a layer. The `+` here used to add a layer to
               * the one machine — which is why "add a state machine" produced a row inside the machine
               * instead of a second machine, and why nothing selected it.
               */
              newMachine(() => seedSceneMachine(`${scene}:${sheetId}`, clips, sequenceLength));
            }}
          >
            +
          </button>
        </h3>
        <ul className="st-list">
          {machines.map((entry) => (
            <li key={entry.id}>
              <div className="st-row" data-active={entry.id === machineId}>
                <button
                  type="button"
                  className="st-row__label st-row__label--button"
                  title={`Open ${entry.name}`}
                  onClick={() => {
                    selectMachine(entry.id);
                  }}
                >
                  {entry.name}
                </button>
                <span className="st-row__meta">
                  {entry.id === machineId ? `${String(definition.layers.length)}L` : ""}
                </span>
                <button
                  type="button"
                  className="st-row__action"
                  title="Delete this machine"
                  onClick={() => {
                    deleteMachine(entry.id);
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="st-section">
        <h3 className="st-section__title">
          Layers
          <button
            type="button"
            className="st-icon"
            title="Add a machine layer"
            onClick={() => {
              let ordinal = definition.layers.length + 1;
              while (definition.layers.some((row) => row.id === `layer-${String(ordinal)}`)) {
                ordinal += 1;
              }
              addLayer(`layer-${String(ordinal)}`);
            }}
          >
            +
          </button>
        </h3>
        <ul className="st-list">
          {definition.layers.map((row) => (
            <li key={row.id}>
              <div className="st-row" data-active={row.id === layer?.id}>
                <button
                  type="button"
                  className="st-row__label st-row__label--button"
                  title={`Edit ${row.id}`}
                  onClick={() => {
                    setDebug({ selectedLayer: row.id });
                  }}
                >
                  {row.id}
                </button>
                <span className="st-row__meta">
                  {row.states.length} state{row.states.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="st-row__action"
                  title="Delete this machine"
                  onClick={() => {
                    removeLayer(row.id);
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="ed-empty">
          Drag a timeline onto the canvas to add a state, or onto a link to insert it.
        </p>
      </section>
    </div>
  );
}

/** A new timeline's duration: the machine's own clips are short, so 1 s is the safe default. */
function sheetLengthHint(definition: MachineDefinition): number {
  const first = definition.layers[0]?.states.find((state) => state.type === "clip");
  if (first != null && "timeline" in first && first.timeline != null) {
    const timeline = definition.timelines?.find((row) => row.id === first.timeline);
    if (timeline != null) return timeline.duration;
  }
  return 1;
}

/**
 * One timeline: a draggable row that opens into its own numbers.
 *
 * Clicking used to do nothing at all — the row's only affordance was the drag — so the only way
 * to change a duration was to add a timeline and hope. The expander is the inspector this row
 * deserves: duration, speed and play style, plus the one action that turns it into a state without
 * a drag (which is the only way to do it on a trackpad in a narrow panel).
 */
function TimelineRow({
  timeline,
  layerId,
  selectedObject,
  onDelete,
  onMakeState,
  onStatus,
}: {
  timeline: TimelineDef;
  layerId: string;
  selectedObject: string | null;
  onDelete: () => void;
  onMakeState: () => void;
  onStatus: (message: string) => void;
}) {
  const patchTimeline = useEditorStore((state) => state.patchTimeline);
  const focused = useEditorStore((state) => state.focusedTimeline);
  const focusTimeline = useEditorStore((state) => state.focusTimeline);
  const [open, setOpen] = useState(false);
  const [draftProp, setDraftProp] = useState("");
  const props = timeline.props ?? [];

  return (
    <li>
      <div
        className="st-row st-row--drag"
        data-open={open}
        draggable
        title={`${timeline.id} · ${String(timeline.duration)}s · ${timeline.playStyle.kind} — drag onto the canvas to make a state, or onto a link to insert it`}
        onDragStart={(event) => {
          dragTimeline(event, timeline.id);
        }}
      >
        <button
          type="button"
          className="st-row__label st-row__label--button"
          data-active={focused === timeline.id}
          data-open={open}
          title="Focus this timeline in the dope sheet, and open its numbers"
          onClick={() => {
            focusTimeline(focused === timeline.id ? null : timeline.id);
            setOpen((value) => !value);
          }}
        >
          {timeline.id}
        </button>
        <span className="st-row__meta">
          {Number(timeline.duration.toFixed(2))}s · {timeline.playStyle.kind}
          {props.length > 0 ? ` · ${String(props.length)} props` : ""}
        </span>
        <button
          type="button"
          className="st-row__action"
          title="Delete this timeline"
          onClick={onDelete}
        >
          ✕
        </button>
      </div>
      {open ? (
        <div className="st-rowbody">
          <label className="st-field">
            <span>duration</span>
            <input
              className="ed-input st-field__input"
              type="number"
              min={0.05}
              step="0.05"
              value={Number(timeline.duration.toFixed(2))}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next) || next <= 0) return;
                patchTimeline(timeline.id, { duration: next });
              }}
            />
          </label>
          <label className="st-field">
            <span>speed</span>
            <input
              className="ed-input st-field__input"
              type="number"
              min={0.05}
              step="0.05"
              value={typeof timeline.speed === "number" ? Number(timeline.speed.toFixed(2)) : 1}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next) || next <= 0) return;
                patchTimeline(timeline.id, { speed: next });
              }}
            />
          </label>
          <label className="st-field">
            <span>play</span>
            <select
              className="ed-input st-field__input"
              value={timeline.playStyle.kind}
              onChange={(event) => {
                const kind = event.target.value;
                const playStyle =
                  kind === "loop"
                    ? ({ kind: "loop" } as const)
                    : kind === "pingPong"
                      ? ({ kind: "pingPong" } as const)
                      : ({ kind: "once" } as const);
                patchTimeline(timeline.id, { playStyle });
              }}
            >
              <option value="loop">loop</option>
              <option value="once">once</option>
              <option value="pingPong">pingPong</option>
            </select>
          </label>
          <label className="st-field">
            <span>length</span>
            <input
              className="ed-input st-field__input"
              type="number"
              min={0.05}
              step="0.05"
              value={Number((timeline.length ?? timeline.duration).toFixed(2))}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next) || next <= 0) return;
                patchTimeline(timeline.id, { length: next });
              }}
            />
          </label>
          <label className="st-field">
            <span>offset</span>
            <input
              className="ed-input st-field__input"
              type="number"
              min={0}
              step="0.05"
              value={Number((timeline.offset ?? 0).toFixed(2))}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next) || next < 0) return;
                patchTimeline(timeline.id, { offset: next });
              }}
            />
          </label>
          <div className="st-field st-field--block">
            <span>props</span>
            <div className="st-chips">
              {props.map((prop) => (
                <span key={prop} className="st-chip">
                  {prop}
                  <button
                    type="button"
                    className="st-chip__x"
                    title={`Remove ${prop} from ${timeline.id}`}
                    onClick={() => {
                      patchTimeline(timeline.id, {
                        props: props.filter((entry) => entry !== prop),
                      });
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {props.length === 0 ? (
                <span className="ed-empty">empty = every track on the sheet</span>
              ) : null}
            </div>
            <div className="st-field__row">
              <input
                className="ed-input st-field__input"
                value={draftProp}
                placeholder="Astro.position.x or Astro.*"
                onChange={(event) => {
                  setDraftProp(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || draftProp.trim() === "") return;
                  patchTimeline(timeline.id, { props: [...props, draftProp.trim()] });
                  setDraftProp("");
                }}
              />
              <button
                type="button"
                className="ed-btn ed-btn--ghost"
                title="Add the selected scene object's tracks"
                onClick={() => {
                  if (selectedObject == null) {
                    onStatus("Select a scene object first.");
                    return;
                  }
                  const path = `${selectedObject}.*`;
                  if (props.includes(path)) return;
                  patchTimeline(timeline.id, { props: [...props, path] });
                  onStatus(`${timeline.id} now owns ${path}`);
                }}
              >
                + selected
              </button>
            </div>
          </div>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => {
              onMakeState();
              onStatus(`Bound ${timeline.id} to a new state on ${layerId}`);
            }}
          >
            → new state
          </button>
        </div>
      ) : null}
    </li>
  );
}
