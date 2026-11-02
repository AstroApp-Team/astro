import { describe, expect, test } from "vite-plus/test";

import type { LayerDef, MachineDefinition } from "@core/models/animationStateMachine.ts";
import {
  LAYOUT,
  fallbackPoint,
  layoutDefinition,
  layoutLayer,
} from "@core/usecases/animationStateMachine/editorLayout.ts";

function layer(states: LayerDef["states"], links: [string, string][]): LayerDef {
  return {
    id: "loco",
    priority: 1,
    blend: "override",
    weight: 1,
    states,
    transitions: links.map(([from, to]) => ({ from, to })),
    anyState: [],
    entry: [{ to: "idle" }],
  };
}

const A = layer(
  [
    { id: "idle", type: "clip" },
    { id: "walk", type: "clip" },
    { id: "run", type: "clip" },
    { id: "fall", type: "clip" },
  ],
  [
    ["idle", "walk"],
    ["walk", "run"],
    ["idle", "fall"],
  ],
);

describe("editorLayout", () => {
  test("a rank is the longest path from an entry state, so run is past walk", () => {
    const { nodes } = layoutLayer(A);
    const idle = nodes["loco/idle"];
    const walk = nodes["loco/walk"];
    const run = nodes["loco/run"];
    expect(idle?.x).toBe(LAYOUT.originX);
    expect(walk?.x).toBe(LAYOUT.originX + LAYOUT.columnGap);
    expect(run?.x).toBe(LAYOUT.originX + LAYOUT.columnGap * 2);
  });

  test("siblings share a column and are stacked by id, not by array order", () => {
    const { nodes } = layoutLayer(
      layer(
        [
          { id: "zzz", type: "clip" },
          { id: "idle", type: "clip" },
          { id: "aaa", type: "clip" },
        ],
        [],
      ),
    );
    /* All three are entry-reachable-at-0, so they share column 0 and sort by id. */
    expect(nodes["loco/aaa"]?.y).toBe(LAYOUT.originY);
    expect(nodes["loco/idle"]?.y).toBe(LAYOUT.originY + LAYOUT.rowGap);
    expect(nodes["loco/zzz"]?.y).toBe(LAYOUT.originY + LAYOUT.rowGap * 2);
  });

  test("the same layer lays out identically every time (§4.4 determinism)", () => {
    expect(layoutLayer(A)).toEqual(layoutLayer(A));
  });

  test("a cycle does not push a rank forever", () => {
    const cycle = layer(
      [
        { id: "idle", type: "clip" },
        { id: "a", type: "clip" },
        { id: "b", type: "clip" },
      ],
      [
        ["idle", "a"],
        ["a", "b"],
        ["b", "a"],
      ],
    );
    const { nodes } = layoutLayer(cycle);
    /* The cycle is broken where it closes, so `b` shares `a`'s rank instead of walking past it.
       What matters is that the rank is a real number and the layout is stable, not that the
       cycle's tail wins. */
    expect(Number.isFinite(nodes["loco/b"]?.x)).toBe(true);
    expect(nodes["loco/b"]?.x).toBeLessThanOrEqual(LAYOUT.originX + LAYOUT.columnGap * 2);
    expect(layoutLayer(cycle)).toEqual(layoutLayer(cycle));
  });

  test("the exit pill sits one column past the furthest state", () => {
    const { systemNodes } = layoutLayer(A);
    expect(systemNodes["loco/__exit"]?.x).toBe(
      LAYOUT.originX + LAYOUT.columnGap * (2 + LAYOUT.exitExtraColumns),
    );
  });

  test("layoutDefinition bands layers so two layers never overlap", () => {
    const definition: MachineDefinition = {
      schemaVersion: 1,
      name: "m",
      inputs: [],
      layers: [A, { ...A, id: "face", priority: 2 }],
    };
    const { nodes } = layoutDefinition(definition);
    const loco = nodes["loco/idle"]?.y ?? 0;
    const face = nodes["face/idle"]?.y ?? 0;
    /* Priority descending decides the band, so the higher-priority layer is the upper one —
       and the two bands are three row-gaps apart, i.e. they cannot overlap. */
    expect(Math.abs(face - loco)).toBe(LAYOUT.rowGap * 3);
  });

  test("fallbackPoint answers for a state and for a system pill", () => {
    const definition: MachineDefinition = {
      schemaVersion: 1,
      name: "m",
      inputs: [],
      layers: [A],
    };
    expect(fallbackPoint(definition, "loco", "loco/walk")).toEqual(
      layoutLayer(A).nodes["loco/walk"],
    );
    expect(fallbackPoint(definition, "loco", "loco/__entry")).toEqual(
      layoutLayer(A).systemNodes["loco/__entry"],
    );
    expect(fallbackPoint(definition, "missing", "loco/walk")).toEqual({
      x: LAYOUT.originX,
      y: LAYOUT.originY,
    });
  });
});
