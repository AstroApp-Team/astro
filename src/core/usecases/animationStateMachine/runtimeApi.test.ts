/**
 * The seven runtime members the editor's telemetry reads (§14 of the editor spec).
 *
 * Each one is tested against behaviour, not shape: a getter that exists and returns `null`
 * for a fade that is obviously running is the bug this file is here to catch. Fixtures are
 * built in code like `machine.test.ts`, so a failure names a rule.
 */

import { describe, expect, test } from "vite-plus/test";

import { staticResolver } from "@core/interfaces/animationAssets.ts";
import type { ClipAsset } from "@core/interfaces/animationAssets.ts";
import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import { createMachine } from "@core/usecases/animationStateMachine/createMachine.ts";

const channel = (
  bone: string,
  times: number[],
  values: number[][],
): ClipAsset["bones"][number] => ({
  bone,
  channel: "position",
  times: new Float32Array(times),
  values: new Float32Array(values.flat()),
});

/** `slide`: the root bone walks 0 → 3 on x over 3 s, 1 m/s. */
const SLIDE = {
  id: "slide",
  duration: 3,
  bones: [
    channel(
      "root",
      [0, 3],
      [
        [0, 0, 0],
        [3, 0, 0],
      ],
    ),
  ],
  morphs: [],
} satisfies ClipAsset;

/**
 * `still`: the root bone does not move, and stands where `slide` starts, so a cut between
 * them contributes no delta of its own. A clip parked somewhere else would make the *cut*
 * look like root motion, which is the one number this test must not measure.
 */
const STILL = {
  id: "still",
  duration: 3,
  bones: [
    channel(
      "root",
      [0, 3],
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    ),
  ],
  morphs: [],
} satisfies ClipAsset;

const resolver = staticResolver([SLIDE, STILL], []);

function definition(overrides: Partial<MachineDefinition> = {}): MachineDefinition {
  return {
    schemaVersion: 1,
    name: "runtime-api",
    scene: "AstroScene",
    tags: ["machine-tag"],
    inputs: [
      { name: "go", kind: "trigger", ttl: 0.25 },
      { name: "blend", kind: "number", default: 0, min: 0, max: 1, smoothTime: 0.2 },
      { name: "quiet", kind: "trigger" },
    ],
    layers: [
      {
        id: "base",
        priority: 0,
        blend: "override",
        weight: 1,
        tags: ["layer-tag"],
        states: [
          {
            id: "idle",
            type: "clip",
            clip: "still",
            tags: ["state-tag"],
          },
          {
            id: "walk",
            type: "clip",
            clip: "slide",
            tags: ["state-tag", "walking"],
          },
        ],
        transitions: [
          {
            from: "idle",
            to: "walk",
            when: { input: "go", op: "fired" },
            duration: 0.5,
            tags: ["transition-tag"],
          },
        ],
        anyState: [],
        entry: [{ to: "idle" }],
      },
    ],
    ...overrides,
  };
}

/* The second constructor argument is `options`, not the resolver: passing the resolver bare
   type-checks (it is one property of an object that is empty) and silently samples an empty
   asset set — which reads as "the clip has no bones" rather than as a bad call. */
const build = (overrides: Partial<MachineDefinition> = {}) =>
  createMachine(definition(overrides), { resolver });

const QUARTER = 1 / 60;

function run(machine: ReturnType<typeof createMachine>, frames: number): void {
  for (let i = 0; i < frames; i += 1) machine.step(QUARTER, i * QUARTER);
}

describe("hasTag", () => {
  test("matches the machine, its layers, states and transitions", () => {
    const machine = build();
    expect(machine.hasTag("machine-tag")).toBe(true);
    expect(machine.hasTag("layer-tag")).toBe(true);
    expect(machine.hasTag("state-tag")).toBe(true);
    expect(machine.hasTag("walking")).toBe(true);
    expect(machine.hasTag("transition-tag")).toBe(true);
  });

  test("an undeclared tag is false, not an error", () => {
    const machine = build();
    expect(machine.hasTag("nope")).toBe(false);
  });
});

describe("getActiveTransition", () => {
  test("is null while a layer owns its state, and live during a fade", () => {
    const machine = build();
    run(machine, 1);
    expect(machine.getActiveTransition("base")).toBeNull();

    machine.fire("go");
    machine.step(QUARTER, 0.02);

    const info = machine.getActiveTransition("base");
    expect(info).not.toBeNull();
    expect(info?.from).toBe("idle");
    expect(info?.to).toBe("walk");
    /* `from` is the *outgoing* state even though the layer already samples `walk`, which is
       the whole reason the record carries both ids. */
    expect(machine.getActiveState("base")?.state).toBe("walk");
    expect(info?.duration).toBeCloseTo(0.5, 6);
    expect(info?.source).toBe("live");
  });

  test("normalized runs 0 → 1 across the fade and the getter goes null at the end", () => {
    const machine = build();
    run(machine, 1);
    machine.fire("go");
    machine.step(QUARTER, 0.02);
    const first = machine.getActiveTransition("base")?.normalized ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);

    run(machine, 31);
    expect(machine.getActiveTransition("base")).toBeNull();
  });
});

describe("transitionComplete", () => {
  test("fires once, after the fade, with the pair that was cut", () => {
    const machine = build();
    const seen: { from: string; to: string }[] = [];
    machine.on("transitionComplete", ({ from, to }) => seen.push({ from, to }));

    run(machine, 1);
    machine.fire("go");
    run(machine, 40);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ from: "idle", to: "walk" });
  });

  test("does not fire for an instant cut in the same frame it is requested", () => {
    const instant = definition({
      layers: [
        {
          ...definition().layers[0]!,
          transitions: [
            { from: "idle", to: "walk", when: { input: "go", op: "fired" }, duration: 0 },
          ],
        },
      ],
    });
    const machine = createMachine(instant, { resolver });
    const seen: string[] = [];
    machine.on("transitionComplete", ({ to }) => seen.push(to));
    run(machine, 1);
    machine.fire("go");
    run(machine, 4);
    expect(seen).toEqual(["walk"]);
  });
});

describe("getSmoothedNumber", () => {
  test("lags the raw target and never overshoots it", () => {
    const machine = build();
    run(machine, 1);
    machine.setNumber("blend", 1);
    machine.step(QUARTER, 0.02);

    const smoothed = machine.getSmoothedNumber("blend");
    expect(smoothed).toBeGreaterThan(0);
    expect(smoothed).toBeLessThan(1);
    /* The raw value is the target, un-smoothed — the two must not be the same number or the
       editor's "raw vs smoothed" readout would be one number drawn twice. */
    expect(machine.getNumber("blend")).toBe(1);

    run(machine, 60);
    expect(machine.getSmoothedNumber("blend")).toBeCloseTo(1, 3);
  });

  test("an unknown input throws, like getNumber", () => {
    const machine = build();
    expect(() => machine.getSmoothedNumber("missing")).toThrow(/unknown number input/);
  });
});

describe("isTriggerPending", () => {
  test("true after fire, false before and once consumed", () => {
    const machine = build();
    expect(machine.isTriggerPending("go")).toBe(false);

    machine.fire("go");
    expect(machine.isTriggerPending("go")).toBe(true);

    run(machine, 2);
    /* Still pending after the cut that consumed it: "consumed" is per layer (§4.3), so a
       trigger stays visible to every other layer until its TTL runs out. */
    expect(machine.isTriggerPending("go")).toBe(true);

    run(machine, 30);
    expect(machine.isTriggerPending("go")).toBe(false);
  });

  test("a trigger nobody consumes stays pending", () => {
    const machine = build();
    machine.fire("quiet");
    run(machine, 30);
    expect(machine.isTriggerPending("quiet")).toBe(true);
  });
});

describe("once", () => {
  test("delivers exactly one event and unsubscribes itself", () => {
    const machine = build();
    /* After the entry frame: the Entry transition is itself a `stateEnter`, and a `once`
       that fires on the first state the machine ever plays is not a subscription, it is a
       race with load. */
    run(machine, 1);
    const seen: string[] = [];
    machine.once("stateEnter", ({ state }) => seen.push(state));

    machine.fire("go");
    run(machine, 40);

    expect(seen).toEqual(["walk"]);
  });

  test("filter runs before the listener, so a once can wait for one state", () => {
    const machine = build();
    const seen: string[] = [];
    machine.once(
      "stateEnter",
      ({ state }) => seen.push(state),
      ({ state }) => state === "walk",
    );

    run(machine, 1);
    machine.fire("go");
    run(machine, 40);

    expect(seen).toEqual(["walk"]);
  });

  test("the returned function cancels a pending once", () => {
    const machine = build();
    const seen: string[] = [];
    const off = machine.once("stateEnter", ({ state }) => seen.push(state));
    off();

    machine.fire("go");
    run(machine, 40);

    expect(seen).toEqual([]);
  });
});

describe("getRootMotion", () => {
  test("is zero before the first frame and on the frame the root first appears", () => {
    const machine = build({ options: { rootBone: "root" } });
    expect(machine.getRootMotion().translation).toEqual([0, 0, 0]);

    machine.fire("go");
    machine.step(QUARTER, 0);
    /* The first frame has no previous position; publishing a delta against zero would
       teleport the model to wherever the clip starts. */
    expect(machine.getRootMotion().translation).toEqual([0, 0, 0]);
  });

  test("publishes the per-frame delta while the clip moves", () => {
    const machine = build({ options: { rootBone: "root" } });
    run(machine, 1);
    machine.fire("go");

    let total = 0;
    for (let i = 0; i < 30; i += 1) {
      machine.step(QUARTER, i * QUARTER);
      total += machine.getRootMotion().translation[0];
    }

    /* `slide` moves 1 unit per second, so half a second of frames is ~0.5 regardless of how
       many frames the fade spends mixing in `still` (whose root is parked at x = 0). */
    expect(total).toBeGreaterThan(0.3);
    expect(total).toBeLessThan(0.8);
  });

  test("a machine with no rootBone reports zero, not the model's own transform", () => {
    const machine = build();
    run(machine, 1);
    machine.fire("go");
    run(machine, 30);
    expect(machine.getRootMotion().translation).toEqual([0, 0, 0]);
  });
});
