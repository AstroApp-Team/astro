/**
 * The left column: everything that is not a card.
 *
 * Inputs, listeners and layers are lists because they are lists in the file — a layer is not a
 * shape on the canvas, it is a row that decides which shapes are drawn, and drawing it as a
 * card would make "move this layer up" look like a spatial operation.
 *
 * The filter is a view over the same rows. It is deliberately not a search across the graph:
 * a filtered graph with half its edges gone is a lie about the machine's shape, while a
 * filtered list is just a shorter list.
 */

import { useState } from "react";

import type {
  InputDef,
  MachineDefinition,
  PointerEventName,
} from "@core/models/animationStateMachine.ts";
import { inputUsages } from "@core/usecases/animationStateMachine/editorOps.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";

function AddInputRow() {
  const addInput = useEditorStore((store) => store.addInput);
  return (
    <div className="ed-row ed-row--tight">
      {(["number", "boolean", "trigger"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          className="ed-btn ed-btn--ghost"
          onClick={() => addInput(kind)}
        >
          + {kind}
        </button>
      ))}
    </div>
  );
}

function InputRow({ input, definition }: { input: InputDef; definition: MachineDefinition }) {
  const select = useEditorStore((store) => store.select);
  const selection = useEditorStore((store) => store.selection);
  const usages = inputUsages(definition, input.name);
  const active = selection?.kind === "input" && selection.name === input.name;
  return (
    <button
      type="button"
      className="ed-row ed-row--item"
      data-active={active ? "true" : undefined}
      onClick={() => select({ kind: "input", name: input.name })}
    >
      <span className="ed-dot" data-kind={input.kind} />
      <span className="ed-row__name">{input.name}</span>
      <span className="ed-row__meta">
        {input.kind === "number" ? `${String(input.default)}` : ""}
        {usages.length === 0 ? "" : ` ·${String(usages.length)}`}
      </span>
    </button>
  );
}

function ListenerRow({ index, mesh, event }: { index: number; mesh: string; event: string }) {
  const select = useEditorStore((store) => store.select);
  const selection = useEditorStore((store) => store.selection);
  const active = selection?.kind === "listener" && selection.index === index;
  return (
    <button
      type="button"
      className="ed-row ed-row--item"
      data-active={active ? "true" : undefined}
      onClick={() => select({ kind: "listener", index })}
    >
      <span className="ed-dot" data-kind="listener" />
      <span className="ed-row__name">{mesh}</span>
      <span className="ed-row__meta">{event}</span>
    </button>
  );
}

function LayerRow({ id }: { id: string }) {
  const select = useEditorStore((store) => store.select);
  const selection = useEditorStore((store) => store.selection);
  const debug = useEditorStore((store) => store.file.debug);
  const setDebug = useEditorStore((store) => store.setDebug);
  const active = selection?.kind === "layer" && selection.layer === id;
  const solo = debug.solo.includes(id);
  const mute = debug.mute.includes(id);
  return (
    <div className="ed-row ed-row--item" data-active={active ? "true" : undefined}>
      <button
        type="button"
        className="ed-row__name ed-row__name--button"
        onClick={() => {
          setDebug({ selectedLayer: id });
          select({ kind: "layer", layer: id });
        }}
      >
        {id}
      </button>
      <button
        type="button"
        className="ed-toggle"
        data-on={solo ? "true" : undefined}
        title="Solo"
        aria-label={`Solo ${id}`}
        onClick={() =>
          setDebug({
            solo: solo ? debug.solo.filter((row) => row !== id) : [...debug.solo, id],
          })
        }
      >
        S
      </button>
      <button
        type="button"
        className="ed-toggle"
        data-on={mute ? "true" : undefined}
        title="Mute"
        aria-label={`Mute ${id}`}
        onClick={() =>
          setDebug({
            mute: mute ? debug.mute.filter((row) => row !== id) : [...debug.mute, id],
          })
        }
      >
        M
      </button>
    </div>
  );
}

export function Sidebar({ definition }: { definition: MachineDefinition }) {
  const filter = useEditorStore((store) => store.filter);
  const setFilter = useEditorStore((store) => store.setFilter);
  const addListener = useEditorStore((store) => store.addListener);
  const [mesh, setMesh] = useState("head");
  const [event, setEvent] = useState<PointerEventName>("click");

  const needle = filter.trim().toLowerCase();
  const inputs = definition.inputs.filter((input) => input.name.toLowerCase().includes(needle));
  const listeners = (definition.listeners ?? []).filter((listener) =>
    `${listener.target.mesh} ${listener.event}`.toLowerCase().includes(needle),
  );
  const layers = definition.layers.filter((layer) => layer.id.toLowerCase().includes(needle));

  return (
    <aside className="ed-sidebar" aria-label="Inputs, listeners and layers">
      <input
        className="ed-input ed-input--search"
        placeholder="Filter…"
        value={filter}
        onChange={(event_) => setFilter(event_.target.value)}
      />

      <section className="ed-section">
        <h2 className="ed-section__title">
          Inputs <span className="ed-section__count">{definition.inputs.length}</span>
        </h2>
        {inputs.map((input) => (
          <InputRow key={input.name} input={input} definition={definition} />
        ))}
        <AddInputRow />
      </section>

      <section className="ed-section">
        <h2 className="ed-section__title">
          Listeners <span className="ed-section__count">{listeners.length}</span>
        </h2>
        {listeners.map((listener, index) => (
          <ListenerRow
            key={`${listener.target.mesh}-${listener.event}-${String(index)}`}
            index={index}
            mesh={listener.target.mesh}
            event={listener.event}
          />
        ))}
        <div className="ed-row ed-row--tight">
          <input
            className="ed-input ed-input--slim"
            value={mesh}
            aria-label="Listener mesh"
            onChange={(event_) => setMesh(event_.target.value)}
          />
          <input
            className="ed-input ed-input--slim"
            value={event}
            aria-label="Listener event"
            onChange={(event_) => setEvent(event_.target.value as PointerEventName)}
          />
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => addListener({ target: { mesh }, event, actions: [] })}
          >
            +
          </button>
        </div>
      </section>

      <section className="ed-section">
        <h2 className="ed-section__title">
          Layers <span className="ed-section__count">{definition.layers.length}</span>
        </h2>
        {layers.map((layer) => (
          <LayerRow key={layer.id} id={layer.id} />
        ))}
      </section>
    </aside>
  );
}
