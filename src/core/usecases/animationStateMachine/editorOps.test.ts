import { describe, expect, test } from "vite-plus/test";

import type { MachineDefinition, StateDef } from "@core/models/animationStateMachine.ts";
import {
  addInput,
  addLayer,
  addListener,
  addState,
  addTransition,
  compactDefinition,
  inputUsages,
  markerOwner,
  moveLayer,
  patchState,
  removeInput,
  removeLayer,
  removeState,
  removeTransition,
  renameInput,
  renameState,
  stateKey,
  stateLinkCounts,
  systemKey,
  withMarkers,
} from "@core/usecases/animationStateMachine/editorOps.ts";

function fixture(): MachineDefinition {
  return {
    schemaVersion: 1,
    name: "hero",
    scene: "AstroScene",
    inputs: [
      { name: "speed", kind: "number", default: 0, min: 0, max: 6 },
      { name: "jump", kind: "trigger" },
      { name: "grounded", kind: "boolean", default: true },
    ],
    layers: [
      {
        id: "locomotion",
        priority: 1,
        blend: "override",
        weight: 1,
        additiveRef: "AstroScene/Astro",
        states: [
          { id: "idle", type: "clip", clip: "AstroScene/Astro" },
          { id: "walk", type: "clip", clip: "AstroScene/Walk", speed: { input: "speed" } },
          { id: "blend", type: "blend1d", input: "speed", children: [] },
        ],
        transitions: [
          {
            from: "idle",
            to: "walk",
            when: { all: [{ input: "speed", op: "greaterThan", value: 0.5 }] },
          },
          { from: "walk", to: "idle", duration: 0.2 },
        ],
        anyState: [{ from: "*", to: "walk", when: { input: "jump", op: "fired" } }],
        entry: [{ to: "idle" }],
      },
      {
        id: "face",
        priority: 2,
        blend: "override",
        weight: { input: "speed", scale: 1 },
        states: [{ id: "idle", type: "clip", clip: "AstroScene/Blink" }],
        transitions: [],
        anyState: [],
        entry: [{ to: "idle" }],
      },
    ],
    listeners: [{ target: { mesh: "Head" }, event: "click", actions: [{ fire: "jump" }] }],
    timelines: [{ id: "walk-tl", duration: 2, playStyle: { kind: "loop" }, speed: 1, markers: [] }],
  };
}

describe("editorOps — states", () => {
  test("addState appends a valid default and returns the id", () => {
    const { definition, stateId } = addState(fixture(), "locomotion", "clip");
    expect(stateId).toBe("state-4");
    const added = definition.layers[0]?.states.at(-1);
    /* The clip is inherited: a `clip` state with no reference is a load error, and the editor's
       preview builds a machine from the draft. */
    expect(added).toEqual({ id: "state-4", type: "clip", clip: "AstroScene/Astro" });
  });

  test("addState does not invent a reference for a state that needs none", () => {
    const { definition, stateId } = addState(fixture(), "face", "exit");
    expect(definition.layers[1]?.states.at(-1)).toEqual({ id: stateId, type: "exit" });
  });

  test("addState refuses a duplicate id instead of shadowing", () => {
    expect(() => addState(fixture(), "locomotion", "clip", "idle")).toThrow(/already has a state/);
  });

  test("removeState also removes every transition that pointed at it", () => {
    const next = removeState(fixture(), "locomotion", "walk");
    const layer = next.layers[0];
    expect(layer?.states.map((state) => state.id)).toEqual(["idle", "blend"]);
    expect(layer?.transitions).toEqual([]);
    expect(layer?.anyState).toEqual([]);
  });

  test("stateLinkCounts reports what a delete would take with it", () => {
    const layer = fixture().layers[0];
    if (layer == null) throw new Error("fixture");
    expect(stateLinkCounts(layer, "walk")).toEqual({ inbound: 2, outbound: 1 });
  });

  test("renameState refactors transitions, anyState and entry rows together", () => {
    const next = renameState(fixture(), "locomotion", "walk", "stride");
    const layer = next.layers[0];
    expect(layer?.states.map((state) => state.id)).toEqual(["idle", "stride", "blend"]);
    expect(layer?.transitions.map((row) => [row.from, row.to])).toEqual([
      ["idle", "stride"],
      ["stride", "idle"],
    ]);
    expect(layer?.anyState[0]?.to).toBe("stride");
  });

  test("renameState refuses an empty or colliding name", () => {
    expect(() => renameState(fixture(), "locomotion", "walk", "  ")).toThrow(/empty/);
    expect(() => renameState(fixture(), "locomotion", "walk", "idle")).toThrow(/already has/);
  });

  test("patchState is shallow and does not touch its neighbours", () => {
    const next = patchState(fixture(), "locomotion", "walk", { speed: 2, exitFade: 0.1 });
    const walk = next.layers[0]?.states[1];
    expect(walk?.speed).toBe(2);
    expect(walk?.exitFade).toBe(0.1);
    expect(next.layers[0]?.states[0]?.speed).toBeUndefined();
  });
});

describe("editorOps — transitions", () => {
  test("addTransition defaults to the state-local list and validates the target", () => {
    const next = addTransition(fixture(), "locomotion", "blend", "idle");
    expect(next.layers[0]?.transitions.at(-1)).toEqual({ from: "blend", to: "idle" });
    expect(() => addTransition(fixture(), "locomotion", "idle", "nope")).toThrow(/no state/);
  });

  test("addTransition can append to anyState, whose `from` is a placeholder", () => {
    const next = addTransition(fixture(), "locomotion", "*", "idle", { anyState: true });
    expect(next.layers[0]?.anyState).toHaveLength(2);
  });

  test("removeTransition indexes the list it was given", () => {
    const next = removeTransition(fixture(), "locomotion", 0);
    expect(next.layers[0]?.transitions).toHaveLength(1);
    expect(() => removeTransition(fixture(), "locomotion", 9)).toThrow(/no transition/);
  });
});

describe("editorOps — layers", () => {
  test("addLayer lands a layer the loader accepts: one state, one entry row", () => {
    const next = addLayer(fixture(), "extras");
    const layer = next.layers.at(-1);
    expect(layer?.states).toHaveLength(1);
    expect(layer?.entry).toEqual([{ to: "idle" }]);
    expect(layer?.priority).toBe(3);
  });

  test("removeLayer refuses to produce the empty layer list the loader rejects", () => {
    const single: MachineDefinition = { ...fixture(), layers: [fixture().layers[0]!] };
    expect(() => removeLayer(single, "locomotion")).toThrow(/at least one layer/);
  });

  test("moveLayer swaps priorities, which is the evaluation order", () => {
    const next = moveLayer(fixture(), "locomotion", -1);
    expect(next.layers[0]?.priority).toBe(2);
    expect(next.layers[1]?.priority).toBe(1);
  });
});

describe("editorOps — inputs", () => {
  test("inputUsages finds every naming site", () => {
    const usages = new Set(inputUsages(fixture(), "speed"));
    /* Walk order, matching the graph: layers, states, then edges. A condition's path stops at
       the transition because `walkCondition` is handed the transition, not its `when`. */
    expect(usages).toEqual(
      new Set([
        "layers[0].states[1].speed.input",
        "layers[0].states[2].input",
        "layers[0].transitions[0].all[0].input",
        "layers[1].weight.input",
      ]),
    );
  });

  test("renameInput rewrites conditions, bindings, blend drivers and listener actions", () => {
    const next = renameInput(fixture(), "jump", "poke");
    expect(next.inputs.map((input) => input.name)).toEqual(["speed", "poke", "grounded"]);
    expect(next.layers[0]?.anyState[0]?.when).toEqual({ input: "poke", op: "fired" });
    expect(next.listeners?.[0]?.actions[0]).toEqual({ fire: "poke" });
    expect(inputUsages(next, "jump")).toEqual([]);
  });

  test("renameInput refuses a collision", () => {
    expect(() => renameInput(fixture(), "speed", "grounded")).toThrow(/already exists/);
  });

  test("addInput names around collisions; removeInput is a filter", () => {
    const added = addInput(fixture(), "number");
    expect(added.name).toBe("number");
    const again = addInput(added.definition, "number");
    expect(again.name).toBe("number2");
    expect(removeInput(fixture(), "speed").inputs).toHaveLength(2);
  });

  test("addListener appends without touching existing rows", () => {
    const next = addListener(fixture(), {
      target: { mesh: "Hand" },
      event: "pointerEnter",
      actions: [{ set: "speed", to: 1 }],
    });
    expect(next.listeners).toHaveLength(2);
  });
});

describe("editorOps — markers", () => {
  test("markerOwner names the timeline when the state references one", () => {
    const withTimeline = patchState(fixture(), "locomotion", "idle", { timeline: "walk-tl" });
    expect(markerOwner(withTimeline, "locomotion", "idle")).toEqual({
      kind: "timeline",
      timelineId: "walk-tl",
      duration: 2,
    });
  });

  test("markers land where the runtime reads them, and only there", () => {
    const withTimeline = patchState(fixture(), "locomotion", "idle", { timeline: "walk-tl" });
    const marker = { time: 0.42, name: "footstep_left" };
    const next = withMarkers(withTimeline, "locomotion", "idle", [marker]);
    expect(next.timelines?.[0]?.markers).toEqual([marker]);
    expect(next.layers[0]?.states[0]?.markers).toBeUndefined();

    const inline = withMarkers(fixture(), "locomotion", "walk", [marker]);
    expect(inline.layers[0]?.states[1]?.markers).toEqual([marker]);
  });
});

describe("editorOps — keys and compaction", () => {
  test("the graph, the editor file and the selection share one key format", () => {
    expect(stateKey("locomotion", "idle")).toBe("locomotion/idle");
    expect(systemKey("locomotion", "any")).toBe("locomotion/__any");
  });

  test("compactDefinition drops undefined so a save is byte-stable", () => {
    const next = compactDefinition(
      patchState(fixture(), "locomotion", "idle", {
        speed: undefined,
      } as unknown as Partial<StateDef>),
    );
    expect(JSON.stringify(next)).not.toContain("undefined");
  });
});
