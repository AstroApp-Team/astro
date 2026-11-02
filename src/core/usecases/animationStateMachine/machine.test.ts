/**
 * The state machine's acceptance suite.
 *
 * Pure logic only: the `node` test project has no DOM, and the whole point of the module
 * is that it runs headless. Every definition here is a fixture built in-code against a
 * `staticResolver`, so a test that fails names a rule, not a filename.
 */

import { describe, expect, test } from "vite-plus/test";

import { staticResolver } from "@core/interfaces/animationAssets.ts";
import type { ClipAsset, MorphCurveAsset } from "@core/interfaces/animationAssets.ts";
import type { MachineDefinition, PointerHit } from "@core/models/animationStateMachine.ts";
import { createMachine, mulberry32 } from "@core/usecases/animationStateMachine/createMachine.ts";
import { MachineDefinitionError } from "@core/usecases/animationStateMachine/validateDefinition.ts";

/* ── Fixtures ────────────────────────────────────────────────────────── */

/** A bone channel: `times` in seconds and one scalar per key, expanded to `stride` values. */
function channel(
  bone: string,
  channelName: "position" | "rotationQuat" | "scale",
  times: number[],
  values: number[][],
) {
  return {
    bone,
    channel: channelName,
    times: new Float32Array(times),
    values: new Float32Array(values.flat()),
  };
}

function clip(
  id: string,
  duration: number,
  bones: ReturnType<typeof channel>[] = [],
  morphs: ClipAsset["morphs"] = [],
): ClipAsset {
  return { id, duration, bones, morphs };
}

const identityQuat = (t: number): [number, number, number, number] => [
  0,
  Math.sin(t / 2),
  0,
  Math.cos(t / 2),
];

/** `walk`: hip rises 0 → 2 over 2 s, and a morph opens 0 → 1 over the same time. */
const WALK = clip(
  "walk",
  2,
  [
    channel(
      "hip",
      "position",
      [0, 2],
      [
        [0, 0, 0],
        [0, 4, 0],
      ],
    ),
  ],
  [
    {
      mesh: "face",
      target: "smile",
      times: new Float32Array([0, 2]),
      values: new Float32Array([0, 1]),
    },
  ],
);

/** `idle`: hip sits at y = 1 for 1 s; y is constant so a fade midpoint is exact. */
const IDLE = clip("idle", 1, [
  channel(
    "hip",
    "position",
    [0, 1],
    [
      [0, 1, 0],
      [0, 1, 0],
    ],
  ),
]);

/** `spin`: the only rotation track, so masks can be told apart per channel. */
const SPIN = clip("spin", 2, [
  channel("hip", "rotationQuat", [0, 2], [identityQuat(0), identityQuat(Math.PI)]),
]);

const BLINK: MorphCurveAsset = {
  id: "blink",
  duration: 0.5,
  morphs: [
    {
      mesh: "face",
      target: "blink",
      times: new Float32Array([0, 0.25, 0.5]),
      values: new Float32Array([0, 1, 0]),
    },
  ],
};

const resolver = staticResolver([WALK, IDLE, SPIN], [BLINK]);

/** Two states, one trigger, one fade — the shape most tests start from. */
function twoState(overrides: Partial<MachineDefinition> = {}): MachineDefinition {
  return {
    schemaVersion: 1,
    name: "two-state",
    inputs: [
      { name: "go", kind: "trigger" },
      { name: "speed", kind: "number", default: 0, min: 0, max: 1 },
      { name: "flag", kind: "boolean", default: false },
    ],
    layers: [
      {
        id: "base",
        priority: 0,
        blend: "override",
        weight: 1,
        states: [
          { id: "idle", type: "clip", clip: "idle" },
          { id: "walk", type: "clip", clip: "walk" },
        ],
        transitions: [
          { from: "idle", to: "walk", when: { input: "go", op: "fired" }, duration: 0 },
        ],
        anyState: [],
        entry: [{ to: "idle" }],
      },
    ],
    ...overrides,
  };
}

const QUARTER = 1 / 60;

/** Step a machine `frames` times at a fixed dt, so a test never depends on wall time. */
function run(
  machine: ReturnType<typeof createMachine>,
  frames: number,
  onStep?: (output: ReturnType<typeof machine.step>, index: number) => void,
): void {
  for (let i = 0; i < frames; i += 1) {
    const output = machine.step(QUARTER, i * QUARTER);
    onStep?.(output, i);
  }
}

/* ── Validation ──────────────────────────────────────────────────────── */

describe("validation", () => {
  test("a bad definition throws a report naming the JSON path, not a first error", () => {
    const bad = twoState();
    bad.layers[0]!.entry = [];
    const error = (() => {
      try {
        createMachine(bad, { resolver });
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(MachineDefinitionError);
    const report = (error as MachineDefinitionError).report;
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.path).toContain("layers[0]");
  });

  test("a transition to a state that does not exist is rejected", () => {
    const bad = twoState();
    bad.layers[0]!.transitions[0]!.to = "nope";
    expect(() => createMachine(bad, { resolver })).toThrow(MachineDefinitionError);
  });

  test("a good definition loads and reports its first frame", () => {
    const machine = createMachine(twoState(), { resolver });
    const output = machine.step(QUARTER, 0);
    expect(output.bones["hip"]?.position?.[1]).toBeCloseTo(1, 5);
  });
});

/* ── Time: play styles, speed, markers ───────────────────────────────── */

describe("time", () => {
  test("a loop wraps and keeps the pose continuous across the seam", () => {
    const machine = createMachine(
      twoState({
        timelines: [{ id: "t", duration: 2, playStyle: { kind: "loop" }, speed: 1 }],
        layers: [
          {
            id: "base",
            priority: 0,
            blend: "override",
            weight: 1,
            states: [{ id: "walk", type: "clip", clip: "walk", timeline: "t" }],
            transitions: [],
            anyState: [],
            entry: [{ to: "walk" }],
          },
        ],
      }),
      { resolver },
    );
    const ys: number[] = [];
    run(machine, 130, (output) => ys.push(output.bones["hip"]?.position?.[1] ?? Number.NaN));
    /* 130 frames at 1/60 is 2.16 s: the clip must have wrapped once, and the first frame
       after the seam must be back near the start, not continue past the end. */
    const afterWrap = ys[121];
    expect(afterWrap).toBeDefined();
    /* Just after the seam the pose is back near the start (y ≈ 0), not past the end. */
    expect(afterWrap ?? 0).toBeLessThan(1);
    expect(ys[60]).toBeCloseTo(2, 1);
  });

  test("a `once` state with onEnd: hold stays at its last pose", () => {
    const machine = createMachine(
      twoState({
        timelines: [{ id: "t", duration: 2, playStyle: { kind: "once", onEnd: "hold" }, speed: 1 }],
        layers: [
          {
            id: "base",
            priority: 0,
            blend: "override",
            weight: 1,
            states: [{ id: "walk", type: "clip", clip: "walk", timeline: "t" }],
            transitions: [],
            anyState: [],
            entry: [{ to: "walk" }],
          },
        ],
      }),
      { resolver },
    );
    const ys: number[] = [];
    run(machine, 200, (output) => ys.push(output.bones["hip"]?.position?.[1] ?? Number.NaN));
    const tail = ys.slice(-10);
    for (const y of tail) expect(y).toBeCloseTo(4, 3);
  });

  test("a negative speed plays the clip backwards", () => {
    const machine = createMachine(
      twoState({
        timelines: [{ id: "t", duration: 2, playStyle: { kind: "loop" }, speed: -1 }],
        layers: [
          {
            id: "base",
            priority: 0,
            blend: "override",
            weight: 1,
            states: [{ id: "walk", type: "clip", clip: "walk", timeline: "t" }],
            transitions: [],
            anyState: [],
            entry: [{ to: "walk" }],
          },
        ],
      }),
      { resolver },
    );
    const ys: number[] = [];
    run(machine, 30, (output) => ys.push(output.bones["hip"]?.position?.[1] ?? Number.NaN));
    /* Backwards from 0 wraps to just under the end, so y is near 4 and falls toward 0. */
    for (let i = 1; i < ys.length; i += 1) {
      expect((ys[i] ?? 0) <= (ys[i - 1] ?? 0) + 1e-6).toBe(true);
    }
  });

  test("markers fire on the frame the cursor crosses them", () => {
    const hits: string[] = [];
    const machine = createMachine(
      twoState({
        timelines: [
          {
            id: "t",
            duration: 2,
            playStyle: { kind: "loop" },
            speed: 1,
            markers: [{ name: "clap", time: 0.5 }],
          },
        ],
        layers: [
          {
            id: "base",
            priority: 0,
            blend: "override",
            weight: 1,
            states: [{ id: "walk", type: "clip", clip: "walk", timeline: "t" }],
            transitions: [],
            anyState: [],
            entry: [{ to: "walk" }],
          },
        ],
      }),
      { resolver },
    );
    machine.on("marker", (event) => hits.push(event.name));
    run(machine, 90);
    expect(hits.filter((name) => name === "clap").length).toBeGreaterThanOrEqual(1);
  });

  test("near-identical inputs give near-identical output (determinism)", () => {
    const build = () => createMachine(twoState(), { resolver, seed: 7 });
    const a = build();
    const b = build();
    for (let i = 0; i < 40; i += 1) {
      const left = a.step(QUARTER, i * QUARTER);
      const right = b.step(QUARTER, i * QUARTER);
      expect(left.bones["hip"]?.position).toEqual(right.bones["hip"]?.position);
    }
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });

  test("a frame longer than `maxDt` is clamped, so a tab switch cannot teleport", () => {
    const machine = createMachine(twoState(), { resolver });
    const output = machine.step(10, 0);
    const progress = machine.getActiveState("base")?.progress ?? 0;
    expect(progress).toBeLessThan(0.6);
    expect(output.bones["hip"]?.position?.[1]).toBeCloseTo(1, 5);
  });
});

/* ── Transitions: triggers, fades, policies ──────────────────────────── */

describe("transitions", () => {
  test("a trigger fires a cut, and the same press does not fire it twice", () => {
    const machine = createMachine(twoState(), { resolver });
    machine.step(QUARTER, 0);
    expect(machine.getActiveState("base")?.state).toBe("idle");

    machine.fire("go");
    machine.step(QUARTER, QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");

    /* A consumed trigger cannot re-fire, even though the transition is still eligible. */
    machine.step(QUARTER, 2 * QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");
  });

  test("a fade blends both channels and both sides of a cut", () => {
    const def = twoState();
    def.layers[0]!.transitions[0]!.duration = 0.5;
    const machine = createMachine(def, { resolver });

    machine.step(QUARTER, 0);
    machine.fire("go");
    /* 15 frames is 0.25 s: halfway through a 0.5 s fade, so the blend is at ~0.5. */
    let blended = machine.step(QUARTER, QUARTER);
    for (let i = 0; i < 14; i += 1) blended = machine.step(QUARTER, (2 + i) * QUARTER);
    const y = blended.bones["hip"]?.position?.[1] ?? Number.NaN;

    /* `idle` is y = 1; `walk` at 1/60 into a 2 s clip is y ≈ 2/120 ≈ 0.017. A fade that
       ran to completion instantly would put y near 0; one that never started would leave
       it at 1. It must be strictly between. */
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(0.9);

    const smile = blended.morphs.find((entry) => entry.mesh === "face")?.weights["smile"] ?? 0;
    expect(smile).toBeGreaterThan(0);
    expect(smile).toBeLessThan(0.5);
  });

  test("`exitTime` holds a cut back until the from state is far enough along", () => {
    const def = twoState();
    def.inputs.push({ name: "leave", kind: "boolean", default: true });
    def.layers[0]!.transitions = [
      {
        from: "idle",
        to: "walk",
        when: { input: "leave", op: "equals", value: true },
        exitTime: 0.75,
      },
    ];
    const machine = createMachine(def, { resolver });

    const states: (string | undefined)[] = [];
    run(machine, 40, () => states.push(machine.getActiveState("base")?.state));
    /* `idle` is 1 s long: 0.75 is 45 frames at 1/60, and the loop runs 40. */
    expect(states.every((state) => state === "idle")).toBe(true);

    run(machine, 10, () => states.push(machine.getActiveState("base")?.state));
    expect(states.at(-1)).toBe("walk");
  });

  test("an `ignore` interruption policy drops a cut that arrives mid-fade", () => {
    const def = twoState();
    def.inputs.push({ name: "back", kind: "trigger" });
    def.layers[0]!.transitions = [
      { from: "idle", to: "walk", when: { input: "go", op: "fired" }, duration: 0.5 },
      {
        from: "walk",
        to: "idle",
        when: { input: "back", op: "fired" },
        interruption: "ignore",
      },
    ];
    const machine = createMachine(def, { resolver });
    const blocked: string[] = [];
    machine.on("blocked", (event) => blocked.push(event.to));

    machine.step(QUARTER, 0);
    machine.fire("go");
    machine.step(QUARTER, QUARTER);
    machine.fire("back");
    machine.step(QUARTER, 2 * QUARTER);

    expect(blocked).toContain("idle");
    expect(machine.getActiveState("base")?.state).toBe("walk");
  });

  test("`reset` returns to the entry state and clears triggers", () => {
    const machine = createMachine(twoState(), { resolver });
    machine.step(QUARTER, 0);
    machine.fire("go");
    machine.step(QUARTER, QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");

    machine.reset();
    machine.step(QUARTER, 0);
    expect(machine.getActiveState("base")?.state).toBe("idle");
    expect(machine.getNumber("speed")).toBe(0);
  });
});

/* ── Layers: override, additive, masks ───────────────────────────────── */

describe("layers", () => {
  const layered = (): MachineDefinition => ({
    schemaVersion: 1,
    name: "layers",
    inputs: [{ name: "wave", kind: "number", default: 0, min: 0, max: 1 }],
    groups: { bones: { upper: ["arm", "head"] } },
    masks: {
      legs: { bones: ["leg"] },
      arms: { bones: ["arm"] },
      noArms: { bones: ["leg", "head", "arm"], subtract: ["arms"] },
    },
    layers: [
      {
        id: "base",
        priority: 0,
        blend: "override",
        weight: 1,
        states: [{ id: "walk", type: "clip", clip: "walk" }],
        transitions: [],
        anyState: [],
        entry: [{ to: "walk" }],
      },
      {
        id: "upper",
        priority: 10,
        blend: "override",
        weight: 1,
        mask: "noArms",
        states: [
          {
            id: "raise",
            type: "direct",
            entries: [
              { input: "wave", target: { bone: "leg", channel: "position.y" }, range: [0, 1] },
            ],
          },
        ],
        transitions: [],
        anyState: [],
        entry: [{ to: "raise" }],
      },
    ],
  });

  test("a masked upper layer writes its own channel and leaves the base alone", () => {
    const machine = createMachine(layered(), { resolver });
    machine.setNumber("wave", 0.5);
    const output = machine.step(QUARTER, 0);
    /* The upper layer owns leg.position.y; the base layer's `walk` pose is untouched
       (hip.y ≈ 0 at t = 0) and `head`, which the mask removes, is never written. */
    expect(output.bones["leg"]?.position?.[1]).toBeCloseTo(0.5, 5);
    expect(output.bones["hip"]?.position?.[1] ?? 0).toBeLessThan(0.1);
    expect(output.bones["head"]).toBeUndefined();
  });

  test("a weight of 0 leaves the base pose untouched", () => {
    const machine = createMachine(layered(), { resolver });
    machine.setNumber("wave", 1);
    machine.setLayerWeight("upper", 0);
    const output = machine.step(QUARTER, 0);
    expect(output.bones["leg"]?.position?.[1] ?? 0).toBeCloseTo(0, 5);
  });

  test("an additive layer adds a delta instead of replacing the pose", () => {
    const def: MachineDefinition = {
      schemaVersion: 1,
      name: "additive",
      inputs: [{ name: "amount", kind: "number", default: 0.5, min: 0, max: 1 }],
      layers: [
        {
          id: "base",
          priority: 0,
          blend: "override",
          weight: 1,
          states: [{ id: "walk", type: "clip", clip: "walk" }],
          transitions: [],
          anyState: [],
          entry: [{ to: "walk" }],
        },
        {
          id: "add",
          priority: 5,
          blend: "additive",
          weight: 1,
          additiveRef: "idle",
          states: [
            {
              id: "pose",
              type: "direct",
              entries: [
                { input: "amount", target: { bone: "hip", channel: "position.y" }, range: [0, 1] },
              ],
            },
          ],
          transitions: [],
          anyState: [],
          entry: [{ to: "pose" }],
        },
      ],
    };
    const machine = createMachine(def, { resolver });
    const output = machine.step(QUARTER, 0);
    const base = output.bones["hip"]?.position?.[1] ?? Number.NaN;
    /* `idle` holds hip.y = 1, so the delta is `amount − 1 = −0.5`; the base's y is ≈0 at
       t=0, so the sum is ≈ −0.5. The important part is that it is *added*, not replaced. */
    expect(base).toBeLessThan(0);
    expect(base).toBeGreaterThan(-1);
  });
});

/* ── Conditions ──────────────────────────────────────────────────────── */

describe("conditions", () => {
  const conditional = (
    when: NonNullable<MachineDefinition["layers"][number]["transitions"][number]["when"]>,
  ) => {
    const def = twoState();
    def.layers[0]!.transitions = [{ from: "idle", to: "walk", when }];
    return createMachine(def, { resolver });
  };

  test("`all` short-circuits, so a trigger after a false leaf is not consumed", () => {
    const machine = conditional({
      all: [
        /* False while `flag` is false — the leaf's value is what has to be *equal* to the
           input, so `equals: true` is the false branch here. */
        { input: "flag", op: "equals", value: true },
        { input: "go", op: "fired" },
      ],
    });
    machine.step(QUARTER, 0);
    machine.step(QUARTER, QUARTER);

    machine.fire("go");
    machine.step(QUARTER, 2 * QUARTER);
    /* The boolean was false, so the trigger leaf never ran and the cut is still waiting. */
    expect(machine.getActiveState("base")?.state).toBe("idle");

    machine.setBoolean("flag", true);
    machine.step(QUARTER, 3 * QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");
  });

  test("`not` inverts and `any` passes when one branch does", () => {
    const machine = conditional({
      any: [
        { not: { input: "flag", op: "equals", value: false } },
        { input: "speed", op: "greaterThan", value: 2 },
      ],
    });
    machine.step(QUARTER, 0);
    machine.step(QUARTER, QUARTER);
    /* `flag` is false, so `not(false == false)` is false and the second branch is false too:
       the cut must not happen. Flipping the flag makes the first branch true. */
    expect(machine.getActiveState("base")?.state).toBe("idle");
    machine.setBoolean("flag", true);
    machine.step(QUARTER, 2 * QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");
  });

  test("a number condition with hysteresis does not chatter at the threshold", () => {
    const def = twoState();
    def.inputs = [{ name: "speed", kind: "number", default: 0, min: 0, max: 1 }];
    def.layers[0]!.transitions = [
      { from: "idle", to: "walk", when: { input: "speed", op: "greaterThan", value: 0.5 } },
      {
        from: "walk",
        to: "idle",
        when: { input: "speed", op: "lessThan", value: 0.5, hysteresis: 0.2 },
      },
    ];
    const machine = createMachine(def, { resolver });
    machine.step(QUARTER, 0);
    machine.setNumber("speed", 0.6);
    machine.step(QUARTER, QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");

    machine.setNumber("speed", 0.45);
    machine.step(QUARTER, QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");
  });
});

/* ── Constraints ─────────────────────────────────────────────────────── */

describe("constraints", () => {
  test("`proportional` puts a bone at exactly 80 % of the distance to another", () => {
    const def = twoState();
    def.constraints = [
      {
        id: "eighty",
        target: { bone: "hand", channel: "position" },
        kind: {
          type: "proportional",
          source: { bone: "hand" },
          reference: { bone: "hip" },
          measure: "distance",
          factor: 0.8,
        },
      },
    ];
    const machine = createMachine(def, { resolver });
    const output = machine.step(QUARTER, 0);
    /* `hip` is at (0, 1, 0) and, with no clip providing `hand`, the hand starts at the
       origin; 80 % of the distance from the origin toward the hip is (0, 0.8, 0). */
    expect(output.bones["hand"]?.position?.[1]).toBeCloseTo(0.8, 3);
  });

  test("a `pointer` constraint follows the hit and holds on a miss", () => {
    const def = twoState();
    def.constraints = [
      {
        id: "drag",
        target: { bone: "hand", channel: "position" },
        kind: {
          type: "pointer",
          pointer: { mesh: "ball" },
          channel: "position.x",
          map: [0, 1, -1, 1],
        },
      },
    ];
    const machine = createMachine(def, { resolver });
    const hit = (uv: [number, number]): PointerHit => ({
      pointerId: 1,
      mesh: "ball",
      uv,
      phase: "move",
    });
    machine.pushPointer(hit([1, 0.5]));
    const followed = machine.step(QUARTER, 0);
    expect(followed.bones["hand"]?.position?.[0]).toBeCloseTo(1, 3);

    /* No hit this frame: the constraint must hold, not snap to zero. */
    const held = machine.step(QUARTER, QUARTER);
    expect(held.bones["hand"]?.position?.[0]).toBeCloseTo(1, 3);
  });

  test("`exposeAs` publishes a value that the next frame's conditions can read", () => {
    const def = twoState();
    def.inputs.push({ name: "reach", kind: "number", default: 0, min: 0, max: 10 });
    def.constraints = [
      {
        id: "reach",
        target: { bone: "hand", channel: "position" },
        kind: {
          type: "proportional",
          source: { bone: "hand" },
          reference: { bone: "hip" },
          measure: "distance",
          factor: 1,
        },
        exposeAs: "reach",
      },
    ];
    def.layers[0]!.transitions = [
      { from: "idle", to: "walk", when: { input: "reach", op: "greaterThan", value: 0.5 } },
    ];
    const machine = createMachine(def, { resolver });
    machine.step(QUARTER, 0);
    machine.step(QUARTER, QUARTER);
    /* The published value lands in the *next* frame's inputs, so the cut is one frame
       behind the solve — that ordering is the contract, not a lag to paper over. */
    machine.step(QUARTER, 2 * QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");
  });
});

/* ── Listeners ───────────────────────────────────────────────────────── */

describe("listeners", () => {
  test("a pointerDown listener fires a trigger, and the cut lands in the same frame", () => {
    const def = twoState();
    def.listeners = [{ target: { mesh: "ball" }, event: "pointerDown", actions: [{ fire: "go" }] }];
    const machine = createMachine(def, { resolver });
    machine.step(QUARTER, 0);

    machine.pushPointer({ pointerId: 1, mesh: "ball", phase: "down" });
    machine.step(QUARTER, QUARTER);
    expect(machine.getActiveState("base")?.state).toBe("walk");
  });

  test("`setFromDrag` maps a drag onto a number input", () => {
    const def = twoState();
    def.inputs.push({ name: "drag", kind: "number", default: 0, min: 0, max: 1 });
    def.listeners = [
      {
        target: { mesh: "ball" },
        event: "drag",
        actions: [{ setFromDrag: "drag", axis: "x", map: [0, 1, 0, 1] }],
      },
    ];
    const machine = createMachine(
      {
        ...def,
        layers: [
          {
            ...def.layers[0]!,
            states: [
              { id: "idle", type: "clip", clip: "idle" },
              {
                id: "walk",
                type: "direct",
                entries: [
                  { input: "drag", target: { bone: "hip", channel: "position.y" }, range: [0, 1] },
                ],
              },
            ],
            transitions: [],
            entry: [{ to: "walk" }],
          },
        ],
      },
      { resolver },
    );

    machine.pushPointer({ pointerId: 1, mesh: "ball", phase: "down", uv: [0.25, 0] });
    machine.step(QUARTER, 0);
    machine.pushPointer({ pointerId: 1, mesh: "ball", phase: "move", uv: [0.75, 0] });
    const output = machine.step(QUARTER, QUARTER);
    expect(output.bones["hip"]?.position?.[1]).toBeGreaterThan(0.5);
  });
});

/* ── Seek and reporting ──────────────────────────────────────────────── */

describe("reporting", () => {
  test("`seek` moves the playhead and `getActiveState` reports progress", () => {
    const machine = createMachine(twoState(), { resolver });
    machine.step(QUARTER, 0);
    machine.seek("base", 0.5);
    const output = machine.step(0, QUARTER);
    expect(machine.getActiveState("base")?.progress).toBeGreaterThan(0.45);
    expect(output.bones["hip"]?.position?.[1]).toBeCloseTo(1, 5);
  });

  test("`setLayerEnabled(false)` drops the layer's contribution", () => {
    const machine = createMachine(twoState(), { resolver });
    machine.setLayerEnabled("base", false);
    const output = machine.step(QUARTER, 0);
    expect(output.bones["hip"]).toBeUndefined();
  });

  test("`on` returns an unsubscribe that stops delivery", () => {
    const machine = createMachine(twoState(), { resolver });
    const seen: string[] = [];
    const off = machine.on("stateEnter", (event) => seen.push(event.state));
    machine.step(QUARTER, 0);
    off();
    machine.fire("go");
    machine.step(QUARTER, QUARTER);
    expect(seen).toEqual(["idle"]);
  });
});
