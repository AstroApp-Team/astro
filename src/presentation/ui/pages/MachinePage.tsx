/**
 * The demo page: canvas on the left, controls and readout on the right.
 *
 * Every control writes **inputs** — `fire`, `setNumber`, `setBoolean`. No clip id, bone name
 * or morph index appears here; that is the spec's whole point, and the page is the proof of
 * it: if the definition were edited to rename a state or swap a clip, nothing in this file
 * would change.
 */

import { IonContent, IonPage } from "@ionic/react";
import { useEffect, useState } from "react";

import type { Machine } from "@core/models/animationStateMachine.ts";
import { MachineCanvas } from "@presentation/canvas/machine/MachineCanvas.tsx";
import { useAnimationMachine } from "@presentation/canvas/machine/useAnimationMachine.ts";
import {
  loadMachineDefinition,
  machineResolver,
  readDefinitionOverride,
} from "@presentation/canvas/machine/machineAuthoring.ts";
import { describeEvent, useMachineStore } from "@presentation/state/useMachineStore.ts";
import "@presentation/ui/styles/machine.css";

/*
 * Module scope: validated once, and the resolver caches per id. `loadMachineDefinition()`
 * prefers a definition saved from the Studio's Machine pane, so a timeline rigged and added
 * there plays here without a rebuild; the shipped JSON is the fallback.
 */
const DEFINITION = loadMachineDefinition();
const RESOLVER = machineResolver();
const FROM_STUDIO = readDefinitionOverride() != null;
const LAYER_IDS = DEFINITION.layers.map((layer) => layer.id);

const NUMBER_INPUTS = DEFINITION.inputs.flatMap((input) =>
  input.kind === "number" ? [{ name: input.name, min: input.min ?? 0, max: input.max ?? 1 }] : [],
);
const BOOLEAN_INPUTS = DEFINITION.inputs.flatMap((input) =>
  input.kind === "boolean" ? [input.name] : [],
);
const TRIGGER_INPUTS = DEFINITION.inputs.flatMap((input) =>
  input.kind === "trigger" ? [input.name] : [],
);

export default function MachinePage() {
  /* `onMachine` lifts the instance into state so the panel can subscribe to its events. The
     hook deliberately does not depend on the callback: an inline closure would rebuild the
     machine on every render. */
  const [machine, setMachine] = useState<Machine | null>(null);
  const handle = useAnimationMachine({
    definition: DEFINITION,
    resolver: RESOLVER,
    seed: 1,
    onMachine: setMachine,
  });

  const [flutters, setFlutters] = useState<Record<string, number>>(() =>
    Object.fromEntries(NUMBER_INPUTS.map((input) => [input.name, input.min])),
  );
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BOOLEAN_INPUTS.map((name) => [name, false])),
  );

  const active = useMachineStore((state) => state.active);
  const events = useMachineStore((state) => state.events);
  const frames = useMachineStore((state) => state.frames);
  const written = useMachineStore((state) => state.bonesWritten);
  const influences = useMachineStore((state) => state.influencesWritten);
  const error = useMachineStore((state) => state.error);
  const clear = useMachineStore((state) => state.clear);

  useEffect(() => {
    if (machine == null) return;
    const offs = [
      machine.on("transition", (event) =>
        useMachineStore.getState().pushEvent({
          at: performance.now(),
          kind: "transition",
          text: describeEvent("transition", event),
        }),
      ),
      machine.on("stateEnter", (event) =>
        useMachineStore.getState().pushEvent({
          at: performance.now(),
          kind: "stateEnter",
          text: describeEvent("stateEnter", event),
        }),
      ),
      machine.on("listener", (event) =>
        useMachineStore.getState().pushEvent({
          at: performance.now(),
          kind: "listener",
          text: describeEvent("listener", event),
        }),
      ),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [machine]);

  return (
    <IonPage>
      <IonContent className="machine-content" fullscreen>
        <div className="machine">
          <header className="machine__head">
            <h1>Animation state machine</h1>
            <p>
              Definitions are data. These controls write inputs only — {LAYER_IDS.length} layers,{" "}
              {DEFINITION.layers.reduce((sum, layer) => sum + layer.states.length, 0)} states, no
              clip name in this file.{" "}
              {FROM_STUDIO
                ? "Playing a definition saved from the Studio."
                : "Playing the shipped definition."}
            </p>
          </header>

          <MachineCanvas handle={handle} layers={LAYER_IDS} />

          <div className="machine__side">
            <section className="machine__panel" aria-label="Machine controls">
              <div className="machine__group">
                {TRIGGER_INPUTS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="machine__btn machine__btn--accent"
                    onClick={() => handle.fire(name)}
                  >
                    {name}
                  </button>
                ))}
                <button type="button" className="machine__btn" onClick={() => handle.reset()}>
                  reset
                </button>
              </div>

              {NUMBER_INPUTS.map((input) => (
                <label key={input.name} className="machine__slider">
                  <span>
                    {input.name} <b>{flutters[input.name]?.toFixed(2) ?? "0.00"}</b>
                  </span>
                  <input
                    type="range"
                    min={input.min}
                    max={input.max}
                    step={0.01}
                    value={flutters[input.name] ?? input.min}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      setFlutters((previous) => ({ ...previous, [input.name]: value }));
                      handle.setNumber(input.name, value);
                    }}
                  />
                </label>
              ))}

              {BOOLEAN_INPUTS.map((name) => (
                <label key={name} className="machine__toggle">
                  <input
                    type="checkbox"
                    checked={flags[name] ?? false}
                    onChange={(event) => {
                      const value = event.currentTarget.checked;
                      setFlags((previous) => ({ ...previous, [name]: value }));
                      handle.setBoolean(name, value);
                    }}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </section>

            <section className="machine__readout" aria-label="Machine readout">
              {active.length === 0 ? (
                <p className="machine__empty">no active state yet</p>
              ) : (
                active.map((line) => (
                  <div key={line.layer} className="machine__state">
                    <span className="machine__state__layer">{line.layer}</span>
                    <span className="machine__state__name">{line.state}</span>
                    <span className="machine__bar">
                      <i style={{ width: `${(line.progress * 100).toFixed(1)}%` }} />
                    </span>
                    <span className="machine__state__meta">
                      {line.progress.toFixed(2)} · {line.speed.toFixed(2)}×
                    </span>
                  </div>
                ))
              )}
              <p className="machine__stats">
                {frames} frames · {written} bones · {influences} morphs this frame
              </p>
              {error == null ? null : <p className="machine__error">{error}</p>}
            </section>
          </div>

          <section className="machine__log" aria-label="Machine events">
            <div className="machine__log__head">
              <h2>events</h2>
              <button type="button" className="machine__btn" onClick={clear}>
                clear
              </button>
            </div>
            {events.length === 0 ? (
              <p className="machine__empty">nothing yet — tap the head or press a trigger</p>
            ) : (
              <ol>
                {events.map((line, index) => (
                  <li key={`${String(line.at)}-${String(index)}`}>
                    <span className="machine__log__kind">{line.kind}</span>
                    {line.text}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
