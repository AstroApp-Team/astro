/**
 * Input state (§4).
 *
 * The public surface is four functions and a snapshot. Everything a condition, a blend
 * weight, a constraint or a speed binding reads goes through `snapshotInputs`, so the
 * frame sees one consistent view of the inputs and a listener write cannot land
 * mid-frame on a condition that already evaluated.
 *
 * `getNumber` returns the **raw target**, `snapshotInputs` returns the **smoothed**
 * value (§4.2). That asymmetry is deliberate: a caller asking for a number wants the
 * value it set, a machine deciding when to cut wants the value the pose is at.
 */

import type { InputDef, NumberInputDef } from "@core/models/animationStateMachine.ts";
import { clamp } from "@core/usecases/animationStateMachine/mathUtil.ts";
import type {
  InputSnapshot,
  NumberInputState,
  TriggerInputState,
} from "@core/usecases/animationStateMachine/types.ts";

export interface InputStore {
  numbers: Map<string, NumberInputState>;
  booleans: Map<string, { name: string; value: boolean }>;
  triggers: Map<string, TriggerInputState>;
  /** Values a constraint published with `exposeAs`, readable from the next frame. */
  derived: Map<string, number>;
  defs: Map<string, InputDef>;
}

/**
 * Critically-damped second-order smoothing (§4.2).
 *
 * The closed form for a critically damped response, which reaches the target in
 * `smoothTime` with no overshoot and no discontinuity in velocity. `x` is the current
 * value, `v` the current velocity, both carried between frames.
 */
function smoothToward(
  current: number,
  velocity: number,
  target: number,
  smoothTime: number,
  dt: number,
): [number, number] {
  if (smoothTime <= 0 || dt <= 0) return [target, 0];

  const omega = 2 / smoothTime;
  const x = omega * dt;
  // Taylor expansion of exp(-x), to 5 terms. exp() per input per frame is measurable
  // at 60 fps with a dozen inputs, and 1e-11 relative error is below the epsilon.
  const exp = 1 / (1 + x + 0.5 * x * x + (1 / 6) * x * x * x + (1 / 24) * x * x * x * x);
  const change = current - target;

  /*
   * The closed form is already non-overshooting for a critically damped spring, so there is
   * no velocity clamp here. There *was* one — `maxChange = smoothTime * velocity` — and it
   * was the bug that made smoothing teleport: velocity is 0 at rest, so `maxChange` was 0,
   * `change` was forced to 0, and the first frame after a set jumped straight to the target
   * with the velocity recomputed as `(output - target) / dt = 0`. A smoothed input that
   * arrives instantly is indistinguishable from an unsmoothed one, which is why the editor's
   * raw-vs-smoothed readout would have shown one number twice.
   */
  const temp = (velocity + omega * change) * dt;
  velocity = (velocity - omega * temp) * exp;
  const output = target + (change + temp) * exp;

  return [output, velocity];
}

export function createInputStore(defs: InputDef[], defaultTriggerTtl: number): InputStore {
  const store: InputStore = {
    numbers: new Map(),
    booleans: new Map(),
    triggers: new Map(),
    derived: new Map(),
    defs: new Map(),
  };

  for (const def of defs) {
    store.defs.set(def.name, def);
    if (def.kind === "number") {
      store.numbers.set(def.name, {
        name: def.name,
        value: def.default,
        smoothed: def.default,
        velocity: 0,
        min: def.min ?? Number.NEGATIVE_INFINITY,
        max: def.max ?? Number.POSITIVE_INFINITY,
        smoothTime: def.smoothTime ?? 0,
      });
    } else if (def.kind === "boolean") {
      store.booleans.set(def.name, { name: def.name, value: def.default });
    } else {
      store.triggers.set(def.name, {
        name: def.name,
        remainingTtl: def.ttl ?? defaultTriggerTtl,
        pending: false,
        ttl: def.ttl ?? defaultTriggerTtl,
        shared: def.shared === true,
      });
    }
  }

  return store;
}

/**
 * Set a number. Out-of-range values are **clamped, not rejected** (§4.1): a drag that
 * overshoots a range is a normal event, and a machine that threw on it would be
 * unusable from a pointer.
 */
export function setNumber(store: InputStore, name: string, value: number): void {
  const input = store.numbers.get(name);
  if (input == null) {
    throw new Error(`Unknown number input "${name}".`);
  }
  input.value = clamp(Number.isFinite(value) ? value : 0, input.min, input.max);
  /*
   * An unsmoothed input is *set*, not approached. Leaving `smoothed` for the next
   * `advanceInputs` gave every hard-set input a one-frame lag: a listener that set a
   * number was invisible to the transitions evaluated in the same frame, which is the
   * exact ordering the frame notes promise.
   */
  if (input.smoothTime <= 0) {
    input.smoothed = input.value;
    input.velocity = 0;
  }
}

export function setBoolean(store: InputStore, name: string, value: boolean): void {
  const input = store.booleans.get(name);
  if (input == null) {
    throw new Error(`Unknown boolean input "${name}".`);
  }
  input.value = value;
}

/**
 * Fire a trigger. Re-firing while one is pending is a **no-op** (§4.1): a listener on
 * `pointerDown` that fires twice in one frame must not queue two cuts.
 */
export function fireTrigger(store: InputStore, name: string): void {
  const trigger = store.triggers.get(name);
  if (trigger == null) {
    throw new Error(`Unknown trigger input "${name}".`);
  }
  if (trigger.pending) return;
  trigger.pending = true;
  trigger.remainingTtl = trigger.ttl;
}

/** The raw target, smoothing ignored (§4.2). */
export function getNumber(store: InputStore, name: string): number {
  const input = store.numbers.get(name);
  if (input == null) {
    throw new Error(`Unknown number input "${name}".`);
  }
  return input.value;
}

export function getBoolean(store: InputStore, name: string): boolean {
  const input = store.booleans.get(name);
  if (input == null) {
    throw new Error(`Unknown boolean input "${name}".`);
  }
  return input.value;
}

/**
 * Advance smoothing and trigger life. Called once per frame, before any condition is
 * evaluated, so a frame sees one smoothed view of every input.
 */
export function advanceInputs(store: InputStore, dt: number): void {
  for (const input of store.numbers.values()) {
    const [smoothed, velocity] = smoothToward(
      input.smoothed,
      input.velocity,
      input.value,
      input.smoothTime,
      dt,
    );
    input.smoothed = smoothed;
    input.velocity = velocity;
  }

  for (const trigger of store.triggers.values()) {
    if (!trigger.pending) continue;
    if (!Number.isFinite(trigger.remainingTtl)) continue;
    trigger.remainingTtl -= dt;
    if (trigger.remainingTtl <= 0) {
      trigger.pending = false;
      trigger.remainingTtl = trigger.ttl;
    }
  }
}

/**
 * Consume a trigger. A non-shared trigger is consumed for the whole machine, because
 * "consumed by the first layer that sees it" (§4.3) has no meaning at machine level
 * once a layer has read it — the layer's own bookkeeping is what makes the order
 * deterministic, not this function.
 */
export function consumeTrigger(store: InputStore, name: string): void {
  const trigger = store.triggers.get(name);
  if (trigger == null) return;
  trigger.pending = false;
  trigger.remainingTtl = trigger.ttl;
}

/**
 * The frame's read-only view. `derived` is the previous frame's constraint output,
 * which is what makes a constraint that publishes an input readable without a cycle.
 */
export function snapshotInputs(store: InputStore): InputSnapshot {
  return {
    numbers: store.numbers,
    booleans: store.booleans,
    triggers: store.triggers,
    derived: store.derived,
  };
}

/** Restore declared defaults, clear triggers, clear derived values. */
export function resetInputs(store: InputStore): void {
  for (const input of store.numbers.values()) {
    const def = store.defs.get(input.name) as NumberInputDef | undefined;
    input.value = def?.default ?? input.value;
    input.smoothed = input.value;
    input.velocity = 0;
  }
  for (const input of store.booleans.values()) {
    const def = store.defs.get(input.name);
    input.value = def?.kind === "boolean" ? def.default : input.value;
  }
  for (const trigger of store.triggers.values()) {
    trigger.pending = false;
    trigger.remainingTtl = trigger.ttl;
  }
  store.derived.clear();
}
