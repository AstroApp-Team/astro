import { describe, expect, test } from "vite-plus/test";

import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import {
  decodeSelection,
  encodeSelection,
  selectionNodeKey,
} from "@core/usecases/animationStateMachine/editorSelection.ts";
import {
  classifyChange,
  structuralHash,
} from "@core/usecases/animationStateMachine/structuralHash.ts";

describe("editorSelection", () => {
  test("every selection kind round-trips through the query string", () => {
    const rows = [
      { kind: "state", layer: "loco", state: "idle" },
      { kind: "transition", layer: "loco", from: "idle", to: "walk", index: 2 },
      { kind: "layer", layer: "face" },
      { kind: "input", name: "speed" },
      { kind: "listener", index: 0 },
      { kind: "timeline", clipId: "AstroScene/Blink" },
    ] as const;
    for (const row of rows) {
      expect(decodeSelection(encodeSelection(row))).toEqual(row);
    }
  });

  test("no selection encodes to nothing", () => {
    expect(encodeSelection(null)).toBeNull();
    expect(decodeSelection(null)).toBeNull();
    expect(decodeSelection("")).toBeNull();
  });

  test("a hand-typed value is null, not a throw", () => {
    expect(decodeSelection("state:")).toBeNull();
    expect(decodeSelection("nonsense")).toBeNull();
    expect(decodeSelection("transition:loco/idle/walk/notanumber")).toBeNull();
    expect(decodeSelection("listener:-1")).toBeNull();
  });

  test("the node key helper only answers for states", () => {
    expect(selectionNodeKey({ kind: "state", layer: "loco", state: "idle" })).toBe("loco/idle");
    expect(selectionNodeKey({ kind: "layer", layer: "loco" })).toBeNull();
  });
});

function definition(): MachineDefinition {
  return {
    schemaVersion: 1,
    name: "m",
    inputs: [{ name: "speed", kind: "number", default: 0 }],
    layers: [
      {
        id: "loco",
        priority: 1,
        blend: "override",
        weight: 1,
        states: [{ id: "idle", type: "clip", clip: "AstroScene/Astro" }],
        transitions: [{ from: "idle", to: "idle", duration: 0.2 }],
        anyState: [],
        entry: [{ to: "idle" }],
      },
    ],
  };
}

describe("structuralHash", () => {
  test("a numeric tuning edit is not a structural change", () => {
    const before = definition();
    const after = structuredClone(before);
    after.layers[0]!.transitions[0]!.duration = 0.9;
    after.layers[0]!.weight = 0.4;
    expect(classifyChange(before, after)).toBe("numeric");
  });

  test("adding a state or a transition is structural", () => {
    const before = definition();
    const added = structuredClone(before);
    added.layers[0]!.states.push({ id: "walk", type: "clip" });
    expect(classifyChange(before, added)).toBe("structural");

    const linked = structuredClone(before);
    linked.layers[0]!.transitions.push({ from: "idle", to: "idle" });
    expect(classifyChange(before, linked)).toBe("structural");
  });

  test("key order does not change the hash, so a save round-trip is not a rebuild", () => {
    const before = definition();
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value == null || typeof value !== "object") return value;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
        out[key] = reorder((value as Record<string, unknown>)[key]);
      }
      return out;
    };
    const reordered = reorder(structuredClone(before)) as MachineDefinition;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(before));
    expect(structuralHash(before)).toBe(structuralHash(reordered));
  });

  test("a clip id change is structural: the sampler would read something else", () => {
    const after = definition();
    const state = after.layers[0]!.states[0];
    if (state?.type === "clip") state.clip = "AstroScene/Walk";
    expect(classifyChange(definition(), after)).toBe("structural");
  });
});
