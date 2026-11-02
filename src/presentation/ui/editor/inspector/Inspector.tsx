/**
 * The right column: the selected thing, and only the selected thing.
 *
 * One deck per selection kind, each editing through the store's op wrappers — never by
 * mutating the draft. Two rules carried over from the spec that shape the code:
 *
 * - **Deleting is a read, then a write.** A state cannot leave its layer without every
 *   transition that points at it disappearing too, so the button says how many links go with
 *   it (`stateLinkCounts`). A delete that silently takes an edge away is a delete nobody
 *   trusts.
 * - **Renaming is a refactor, not a field edit** (`renameState`'s own contract). A card whose
 *   name is a string in one place and a key in four others cannot be renamed by editing the
 *   label.
 */

import { useState } from "react";

import type {
  Condition,
  InputDef,
  LayerDef,
  MachineDefinition,
  StateDef,
  TransitionDef,
} from "@core/models/animationStateMachine.ts";
import type { Selection } from "@core/models/animationStateMachineEditor.ts";
import {
  clipIdOf,
  findLayer,
  findState,
  inputUsages,
  markerOwner,
  stateLinkCounts,
} from "@core/usecases/animationStateMachine/editorOps.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";

/* `Easing` is a tagged union (`{ kind }`), not a string: the bezier variant carries four
   numbers, so the picker offers the kinds it can build without asking for them. */
const EASING_KINDS = ["linear", "easeIn", "easeOut", "easeInOut", "smoothstep"] as const;

type EasingKind = (typeof EASING_KINDS)[number];

/** A numeric field clears its property rather than writing `undefined` (`exactOptionalPropertyTypes`). */
function numberPatch(key: keyof StateDef, value: number | undefined): Partial<StateDef> {
  return value == null || value === 0 ? {} : ({ [key]: value } as Partial<StateDef>);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ed-field">
      <span className="ed-field__label">{label}</span>
      {children}
    </label>
  );
}

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: Condition | undefined;
  onChange: (condition: Condition | undefined) => void;
}) {
  const [raw, setRaw] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(condition ?? null, null, 2));
  const leaves = condition != null && "all" in condition ? condition.all : null;

  if (raw) {
    return (
      <div className="ed-deck__body">
        <Field label="when (JSON)">
          <textarea
            className="ed-textarea"
            value={text}
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              try {
                const parsed = JSON.parse(text) as Condition | null;
                onChange(parsed ?? undefined);
                setRaw(false);
              } catch {
                /* Keeping the textarea open on a parse error is the only honest response:
                   closing it would discard the text the reader is still editing. */
              }
            }}
          />
        </Field>
      </div>
    );
  }

  return (
    <div className="ed-deck__body">
      <div className="ed-row">
        <span className="ed-field__label">when</span>
        <button type="button" className="ed-btn ed-btn--ghost" onClick={() => setRaw(true)}>
          raw
        </button>
      </div>
      {leaves == null ? (
        <p className="ed-empty">
          {condition == null
            ? "Always — an unconditional transition."
            : "A composed condition. Open raw to edit it."}
        </p>
      ) : (
        leaves.map((leaf, index) => (
          <p className="ed-empty" key={`${String(index)}`}>
            {JSON.stringify(leaf)}
          </p>
        ))
      )}
    </div>
  );
}

function StateDeck({
  layer,
  stateId,
  definition,
}: {
  layer: LayerDef;
  stateId: string;
  definition: MachineDefinition;
}) {
  const patchState = useEditorStore((store) => store.patchState);
  const renameState = useEditorStore((store) => store.renameState);
  const removeState = useEditorStore((store) => store.removeState);
  const select = useEditorStore((store) => store.select);
  const state = findState(definition, layer.id, stateId);
  const [name, setName] = useState(stateId);

  if (state == null) return <p className="ed-empty">That state no longer exists.</p>;
  const links = stateLinkCounts(layer, stateId);
  const clip = clipIdOf(state);

  return (
    <div className="ed-deck">
      <div className="ed-deck__head">
        <span className="ed-chip" data-type={state.type}>
          {state.type}
        </span>
        <span className="ed-deck__id">{stateId}</span>
      </div>
      <div className="ed-deck__body">
        <Field label="id">
          <input
            className="ed-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name !== stateId) renameState(layer.id, stateId, name);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </Field>
        <Field label="labels / tags">
          <input
            className="ed-input"
            defaultValue={(state.tags ?? []).join(", ")}
            onBlur={(event) =>
              patchState(layer.id, stateId, {
                tags: event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag !== ""),
              })
            }
          />
        </Field>
        {clip == null ? null : (
          <Field label="clip / timeline">
            <input
              className="ed-input"
              defaultValue={clip}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value === "") return;
                patchState(layer.id, stateId, { clip: value } as Partial<StateDef>);
              }}
            />
          </Field>
        )}
        <div className="ed-grid2">
          <Field label="speed">
            <input
              className="ed-input"
              type="number"
              step="0.05"
              defaultValue={
                state.speed == null ? 1 : typeof state.speed === "number" ? state.speed : ""
              }
              onBlur={(event) => {
                const value = Number(event.target.value);
                patchState(
                  layer.id,
                  stateId,
                  numberPatch("speed", Number.isFinite(value) ? value : undefined),
                );
              }}
            />
          </Field>
          <Field label="time scale">
            <input
              className="ed-input"
              type="number"
              step="0.05"
              defaultValue={state.timeScale ?? 1}
              onBlur={(event) =>
                patchState(
                  layer.id,
                  stateId,
                  numberPatch("timeScale", Number(event.target.value) || undefined),
                )
              }
            />
          </Field>
          <Field label="entry fade">
            <input
              className="ed-input"
              type="number"
              step="0.05"
              min="0"
              defaultValue={state.entryFade ?? 0}
              onBlur={(event) =>
                patchState(
                  layer.id,
                  stateId,
                  numberPatch("entryFade", Number(event.target.value) || undefined),
                )
              }
            />
          </Field>
          <Field label="exit fade">
            <input
              className="ed-input"
              type="number"
              step="0.05"
              min="0"
              defaultValue={state.exitFade ?? 0}
              onBlur={(event) =>
                patchState(
                  layer.id,
                  stateId,
                  numberPatch("exitFade", Number(event.target.value) || undefined),
                )
              }
            />
          </Field>
          <Field label="start at">
            <input
              className="ed-input"
              type="number"
              step="0.05"
              min="0"
              max="1"
              defaultValue={typeof state.startAt === "number" ? state.startAt : 0}
              onBlur={(event) =>
                patchState(
                  layer.id,
                  stateId,
                  numberPatch("startAt", Number(event.target.value) || undefined),
                )
              }
            />
          </Field>
        </div>
        {"children" in state ? (
          <p className="ed-empty">
            {String(state.children.length)} blend children · driver{" "}
            {"inputX" in state ? `${state.inputX} / ${state.inputY}` : String(state.input)}
          </p>
        ) : null}
        <div className="ed-deck__danger">
          <button
            type="button"
            className="ed-btn ed-btn--danger"
            onClick={() => removeState(layer.id, stateId)}
          >
            Delete state
            {links.inbound + links.outbound === 0
              ? ""
              : ` (+${String(links.inbound + links.outbound)} links)`}
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => select({ kind: "layer", layer: layer.id })}
          >
            Layer…
          </button>
        </div>
      </div>
    </div>
  );
}

function TransitionDeck({
  layer,
  row,
  index,
  anyState,
}: {
  layer: LayerDef;
  row: TransitionDef;
  index: number;
  anyState: boolean;
}) {
  const patchTransition = useEditorStore((store) => store.patchTransition);
  const removeTransition = useEditorStore((store) => store.removeTransition);
  return (
    <div className="ed-deck">
      <div className="ed-deck__head">
        <span className="ed-chip" data-type="transition">
          {anyState ? "any state" : "transition"}
        </span>
        <span className="ed-deck__id">
          {row.from} → {row.to}
        </span>
      </div>
      <div className="ed-deck__body">
        <ConditionEditor
          condition={row.when}
          onChange={(when) => patchTransition(layer.id, index, when == null ? {} : { when })}
        />
        <div className="ed-grid2">
          <Field label="fade">
            <input
              className="ed-input"
              type="number"
              step="0.05"
              min="0"
              defaultValue={row.duration ?? 0.2}
              onBlur={(event) =>
                patchTransition(layer.id, index, {
                  duration: Math.max(0, Number(event.target.value)),
                })
              }
            />
          </Field>
          <Field label="easing">
            <select
              className="ed-input"
              defaultValue={row.easing?.kind ?? "easeInOut"}
              onChange={(event) =>
                patchTransition(layer.id, index, {
                  easing: { kind: event.target.value as EasingKind },
                })
              }
            >
              {EASING_KINDS.map((easing) => (
                <option key={easing} value={easing}>
                  {easing}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="target">
          <input className="ed-input" defaultValue={row.to} readOnly />
        </Field>
        <div className="ed-deck__danger">
          <button
            type="button"
            className="ed-btn ed-btn--danger"
            onClick={() => removeTransition(layer.id, index, anyState)}
          >
            Delete transition
          </button>
        </div>
      </div>
    </div>
  );
}

function LayerDeck({ layer, definition }: { layer: LayerDef; definition: MachineDefinition }) {
  const patchLayer = useEditorStore((store) => store.patchLayer);
  const moveLayer = useEditorStore((store) => store.moveLayer);
  const removeLayer = useEditorStore((store) => store.removeLayer);
  const setDebug = useEditorStore((store) => store.setDebug);
  const setSelection = useEditorStore((store) => store.select);
  const index = definition.layers.findIndex((row) => row.id === layer.id);

  return (
    <div className="ed-deck">
      <div className="ed-deck__head">
        <span className="ed-chip" data-type="layer">
          layer
        </span>
        <span className="ed-deck__id">{layer.id}</span>
      </div>
      <div className="ed-deck__body">
        <div className="ed-grid2">
          <Field label="priority">
            <input
              className="ed-input"
              type="number"
              defaultValue={layer.priority}
              onBlur={(event) => patchLayer(layer.id, { priority: Number(event.target.value) })}
            />
          </Field>
          <Field label="blend">
            <select
              className="ed-input"
              defaultValue={layer.blend}
              onChange={(event) =>
                patchLayer(layer.id, { blend: event.target.value as "override" })
              }
            >
              <option value="override">override</option>
              <option value="additive">additive</option>
            </select>
          </Field>
          <Field label="weight">
            <input
              className="ed-input"
              type="number"
              step="0.05"
              min="0"
              max="1"
              defaultValue={typeof layer.weight === "number" ? layer.weight : 1}
              onBlur={(event) => patchLayer(layer.id, { weight: Number(event.target.value) })}
            />
          </Field>
          <Field label="additive ref">
            <input
              className="ed-input"
              defaultValue={layer.additiveRef ?? ""}
              onBlur={(event) =>
                patchLayer(
                  layer.id,
                  event.target.value.trim() === ""
                    ? {}
                    : { additiveRef: event.target.value.trim() },
                )
              }
            />
          </Field>
        </div>
        <Field label="entry">
          <input
            className="ed-input"
            defaultValue={layer.entry.map((row) => row.to).join(" → ")}
            readOnly
          />
        </Field>
        <div className="ed-row">
          <button type="button" className="ed-btn" onClick={() => moveLayer(layer.id, -1)}>
            ↑ earlier
          </button>
          <button type="button" className="ed-btn" onClick={() => moveLayer(layer.id, 1)}>
            ↓ later
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => {
              setDebug({ selectedLayer: layer.id });
              setSelection({ kind: "layer", layer: layer.id });
            }}
          >
            focus
          </button>
        </div>
        <div className="ed-deck__danger">
          <button
            type="button"
            className="ed-btn ed-btn--danger"
            onClick={() => removeLayer(layer.id)}
            disabled={definition.layers.length <= 1}
            title={
              definition.layers.length <= 1 ? "A machine needs at least one layer." : undefined
            }
          >
            Delete layer ({String(index + 1)} of {String(definition.layers.length)})
          </button>
        </div>
      </div>
    </div>
  );
}

function InputDeck({ input, definition }: { input: InputDef; definition: MachineDefinition }) {
  const patchInput = useEditorStore((store) => store.patchInput);
  const renameInput = useEditorStore((store) => store.renameInput);
  const removeInput = useEditorStore((store) => store.removeInput);
  const [name, setName] = useState(input.name);
  const usages = inputUsages(definition, input.name);

  return (
    <div className="ed-deck">
      <div className="ed-deck__head">
        <span className="ed-chip" data-type={input.kind}>
          {input.kind}
        </span>
        <span className="ed-deck__id">{input.name}</span>
      </div>
      <div className="ed-deck__body">
        <Field label="name">
          <input
            className="ed-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name !== input.name) renameInput(input.name, name);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </Field>
        {input.kind === "number" ? (
          <div className="ed-grid2">
            <Field label="default">
              <input
                className="ed-input"
                type="number"
                defaultValue={input.default}
                onBlur={(event) => patchInput(input.name, { default: Number(event.target.value) })}
              />
            </Field>
            <Field label="min">
              <input
                className="ed-input"
                type="number"
                defaultValue={input.min ?? 0}
                onBlur={(event) => patchInput(input.name, { min: Number(event.target.value) })}
              />
            </Field>
            <Field label="max">
              <input
                className="ed-input"
                type="number"
                defaultValue={input.max ?? 1}
                onBlur={(event) => patchInput(input.name, { max: Number(event.target.value) })}
              />
            </Field>
          </div>
        ) : null}
        <p className="ed-empty">
          {usages.length === 0 ? "Not referenced yet." : usages.join(" · ")}
        </p>
        <div className="ed-deck__danger">
          <button
            type="button"
            className="ed-btn ed-btn--danger"
            onClick={() => removeInput(input.name)}
            disabled={usages.length > 0}
            title={
              usages.length > 0
                ? "Still referenced — renaming is safe, deleting is not."
                : undefined
            }
          >
            Delete input
          </button>
        </div>
      </div>
    </div>
  );
}

function ListenerDeck({ definition, index }: { definition: MachineDefinition; index: number }) {
  const removeListener = useEditorStore((store) => store.removeListener);
  const listener = definition.listeners?.[index];
  if (listener == null) return <p className="ed-empty">That listener no longer exists.</p>;
  return (
    <div className="ed-deck">
      <div className="ed-deck__head">
        <span className="ed-chip" data-type="listener">
          listener
        </span>
        <span className="ed-deck__id">
          {listener.target.mesh} · {listener.event}
        </span>
      </div>
      <div className="ed-deck__body">
        <Field label="actions">
          <input
            className="ed-input"
            defaultValue={listener.actions.map((action) => JSON.stringify(action)).join(", ")}
            readOnly
          />
        </Field>
        <div className="ed-deck__danger">
          <button
            type="button"
            className="ed-btn ed-btn--danger"
            onClick={() => removeListener(index)}
          >
            Delete listener
          </button>
        </div>
      </div>
    </div>
  );
}

function MarkerCreator({ onAdd }: { onAdd: (marker: { time: number; name: string }) => void }) {
  const [name, setName] = useState("marker");
  const [time, setTime] = useState("0");
  return (
    <div className="ed-row">
      <input
        className="ed-input ed-input--slim"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="ed-input ed-input--slim"
        type="number"
        step="0.05"
        min="0"
        value={time}
        onChange={(event) => setTime(event.target.value)}
      />
      <button
        type="button"
        className="ed-btn ed-btn--ghost"
        onClick={() => {
          if (name.trim() === "") return;
          onAdd({ time: Math.max(0, Number(time) || 0), name: name.trim() });
        }}
      >
        + marker
      </button>
    </div>
  );
}

function MarkerDeck({
  definition,
  layer,
  state,
}: {
  definition: MachineDefinition;
  layer: string;
  state: string;
}) {
  const setMarkers = useEditorStore((store) => store.setMarkers);
  const owner = markerOwner(definition, layer, state);
  const defState = findState(definition, layer, state);
  if (owner == null || defState == null) {
    return <p className="ed-empty">This state has no clip, so it has nowhere to put a marker.</p>;
  }
  const markers =
    owner.kind === "timeline"
      ? (definition.timelines?.find((row) => row.id === owner.timelineId)?.markers ?? [])
      : (defState.markers ?? []);
  return (
    <div className="ed-deck">
      <div className="ed-deck__head">
        <span className="ed-chip" data-type="marker">
          markers
        </span>
        <span className="ed-deck__id">
          {owner.kind === "timeline" ? owner.timelineId : `${layer}/${state}`} · {markers.length}
        </span>
      </div>
      <div className="ed-deck__body">
        {markers.length === 0 ? <p className="ed-empty">No markers.</p> : null}
        {markers.map((marker, index) => (
          <div className="ed-row" key={`${marker.name}-${String(index)}`}>
            <span className="ed-deck__id">
              {marker.time.toFixed(2)}s {marker.name}
            </span>
            <button
              type="button"
              className="ed-btn ed-btn--ghost"
              onClick={() =>
                setMarkers(
                  layer,
                  state,
                  markers.filter((_, at) => at !== index),
                )
              }
            >
              ✕
            </button>
          </div>
        ))}
        <MarkerCreator onAdd={(marker) => setMarkers(layer, state, [...markers, marker])} />
      </div>
    </div>
  );
}

export function Inspector({ definition }: { definition: MachineDefinition }) {
  const selection: Selection = useEditorStore((store) => store.selection);
  if (selection == null) {
    return (
      <div className="ed-inspector__empty">
        <p>Select a card, an edge, a layer, an input or a listener.</p>
        <p className="ed-empty">
          Canvas · {definition.layers.length} layers · {definition.inputs.length} inputs ·{" "}
          {definition.layers.reduce((total, layer) => total + layer.states.length, 0)} states
        </p>
      </div>
    );
  }

  switch (selection.kind) {
    case "state": {
      const layer = findLayer(definition, selection.layer);
      if (layer == null) return <p className="ed-empty">That layer no longer exists.</p>;
      return (
        <>
          <StateDeck layer={layer} stateId={selection.state} definition={definition} />
          <MarkerDeck definition={definition} layer={selection.layer} state={selection.state} />
        </>
      );
    }
    case "transition": {
      const layer = findLayer(definition, selection.layer);
      const row = layer?.transitions[selection.index] ?? layer?.anyState[selection.index];
      if (layer == null || row == null)
        return <p className="ed-empty">That edge no longer exists.</p>;
      return (
        <TransitionDeck
          layer={layer}
          row={row}
          index={selection.index}
          anyState={layer.transitions[selection.index] == null}
        />
      );
    }
    case "layer": {
      const layer = findLayer(definition, selection.layer);
      return layer == null ? (
        <p className="ed-empty">That layer no longer exists.</p>
      ) : (
        <LayerDeck layer={layer} definition={definition} />
      );
    }
    case "input": {
      const input = definition.inputs.find((row) => row.name === selection.name);
      return input == null ? (
        <p className="ed-empty">That input no longer exists.</p>
      ) : (
        <InputDeck input={input} definition={definition} />
      );
    }
    case "listener":
      return <ListenerDeck definition={definition} index={selection.index} />;
    case "timeline":
      return (
        <div className="ed-deck">
          <div className="ed-deck__head">
            <span className="ed-chip" data-type="timeline">
              timeline
            </span>
            <span className="ed-deck__id">{selection.clipId}</span>
          </div>
          <div className="ed-deck__body">
            <p className="ed-empty">
              Timelines are rigged in the Studio; the editor references them and places markers.
            </p>
          </div>
        </div>
      );
    default:
      return null;
  }
}
