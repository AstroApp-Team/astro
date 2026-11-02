/**
 * Condition evaluation (§4.4).
 *
 * `all` and `any` short-circuit **left to right**, and that is load-bearing: a trigger
 * leaf consumes on read, so the leaf after a true `all` branch never runs and the
 * trigger stays pending for the next transition. A definition that relies on that
 * ordering is correct, and a definition that relies on the opposite ordering is a
 * definition the author has to fix.
 *
 * Hysteresis is stateful, so it needs a **site key** — the same condition evaluated on
 * two transitions is two sites with two memories. `conditionKey` builds that key, and
 * the caller owns the map.
 */

import type {
  Condition,
  LeafCondition,
  NumberCondition,
} from "@core/models/animationStateMachine.ts";
import type { InputSnapshot } from "@core/usecases/animationStateMachine/types.ts";

/**
 * A stable key for one condition site. The same `Condition` object appearing on two
 * transitions, or on a transition and a blend weight, must not share hysteresis state.
 */
export function conditionKey(layerId: string, transitionKey: string, path: string): string {
  return `${layerId}|${transitionKey}|${path}`;
}

export interface EvalContext {
  inputs: InputSnapshot;
  /** Hysteresis memory, keyed by `conditionKey`. Owned by the caller. */
  memory: Map<string, boolean>;
  /** Triggers consumed during this evaluation. The caller decides what to do with them. */
  consumed: Set<string>;
  /** Comparison epsilon from `options.epsilon`. */
  epsilon: number;
  /** The site key prefix: `layerId|transitionKey`. */
  site: string;
}

/**
 * Evaluate a condition tree.
 *
 * `path` indexes nested nodes so a hysteresis leaf gets a stable identity
 * (`layer|transition|when.all[0].all[1]`), which is what the memory map keys on.
 */
export function evalCondition(condition: Condition, ctx: EvalContext, path = ""): boolean {
  if ("all" in condition) {
    return condition.all.every((child, index) =>
      evalCondition(child, ctx, `${path}.all[${String(index)}]`),
    );
  }
  if ("any" in condition) {
    return condition.any.some((child, index) =>
      evalCondition(child, ctx, `${path}.any[${String(index)}]`),
    );
  }
  if ("not" in condition) {
    return !evalCondition(condition.not, ctx, `${path}.not`);
  }

  return evalLeaf(condition, ctx, path);
}

function evalLeaf(leaf: LeafCondition, ctx: EvalContext, path: string): boolean {
  const site = conditionKey(ctx.site, "", path);

  // The leaves are discriminated by `op`, and that is the only safe narrowing: a
  // trigger input and a number input can share a name in a hand-edited definition, and
  // reading `leaf.consume` off a number leaf is a type error, not a runtime one.
  if (leaf.op === "fired") {
    const trigger = ctx.inputs.triggers.get(leaf.input);
    const fired = trigger?.pending ?? false;
    // Consume on read, default true. A leaf that sets `consume: false` lets several
    // transitions see one fire, which is the only way a trigger gates an `any` branch.
    if (fired && leaf.consume !== false) {
      ctx.consumed.add(leaf.input);
    }
    return fired;
  }

  /*
   * The discriminator is the leaf's own `value`: `BooleanCondition.value` is required and
   * `TriggerCondition` has none, so a boolean leaf is exactly a leaf carrying a boolean.
   * Comparison uses that value — the first version read
   * `(value ?? false) === (op === "equals")`, which ignored `value` entirely and made
   * `{ input: "flag", op: "equals", value: false }` true for a false flag *and* true for a
   * true one, i.e. a condition that cannot be false.
   */
  if (typeof leaf.value === "boolean") {
    const bool = ctx.inputs.booleans.get(leaf.input);
    const current = bool?.value ?? false;
    return leaf.op === "notEquals" ? current !== leaf.value : current === leaf.value;
  }

  /*
   * A value a constraint published with `exposeAs` **shadows** a declared input of the
   * same name: the derived table is this frame's solved value, and a declared default
   * would otherwise win and pin the condition at its default forever.
   */
  const derived = ctx.inputs.derived.get(leaf.input);
  if (derived != null) return evalNumber(derived, leaf, ctx, site);

  const number = ctx.inputs.numbers.get(leaf.input);
  if (number == null) {
    // An unknown input is false. The validator rejects it at load; reaching here means a
    // definition bypassed validation, and a false condition is the safe reading.
    return false;
  }
  return evalNumber(number.smoothed, leaf, ctx, site);
}

function evalNumber(
  current: number,
  leaf: NumberCondition,
  ctx: EvalContext,
  site: string,
): boolean {
  const target = leaf.value;
  // The band is the hysteresis, widened by the epsilon so `equals` keeps its tolerance.
  const band = (leaf.hysteresis ?? 0) + ctx.epsilon;
  const previous = ctx.memory.get(site) === true;

  let result: boolean;
  if (previous) {
    // Already true: it releases only when the value crosses the far edge of the band.
    switch (leaf.op) {
      case "greaterThan":
      case "greaterOrEqual":
        result = current >= target - band;
        break;
      case "lessThan":
      case "lessOrEqual":
        result = current <= target + band;
        break;
      case "equals":
        result = Math.abs(current - target) <= band;
        break;
      case "notEquals":
        result = Math.abs(current - target) > band;
        break;
      default:
        result = false;
    }
  } else {
    // Not yet true: it engages on the far side of the band, never at the threshold.
    switch (leaf.op) {
      case "greaterThan":
      case "greaterOrEqual":
        result = current > target + band;
        break;
      case "lessThan":
      case "lessOrEqual":
        result = current < target - band;
        break;
      case "equals":
        result = Math.abs(current - target) <= band;
        break;
      case "notEquals":
        result = Math.abs(current - target) > band;
        break;
      default:
        result = false;
    }
  }

  ctx.memory.set(site, result);
  return result;
}

/**
 * Resolve a numeric binding — a layer weight, a speed, a timeline speed — to a number.
 *
 * The input form is `{ input, scale?, offset? }`. An unknown input resolves to the
 * binding's constant fallback, never to 0: a weight that silently became 0 would mute
 * a layer with no diagnostic.
 */
export function resolveNumberBinding(
  binding: number | { input: string; scale?: number; offset?: number } | undefined,
  fallback: number,
  inputs: InputSnapshot,
): number {
  if (binding == null) return fallback;
  if (typeof binding === "number") return binding;

  const input = inputs.numbers.get(binding.input);
  if (input == null) return fallback;
  return input.smoothed * (binding.scale ?? 1) + (binding.offset ?? 0);
}

/** Resolve a `SpeedBinding`, clamped away from zero: a speed of 0 freezes a clip. */
export function resolveSpeed(
  binding: number | { input: string; scale?: number; offset?: number } | undefined,
  fallback: number,
  inputs: InputSnapshot,
  epsilon: number,
): number {
  const raw = resolveNumberBinding(binding, fallback, inputs);
  if (!Number.isFinite(raw)) return fallback;
  if (Math.abs(raw) < epsilon) return raw >= 0 ? epsilon : -epsilon;
  return raw;
}

/** Resolve a layer weight into [0, 1]. */
export function resolveWeight(
  weight: number | { input: string; scale?: number } | undefined,
  inputs: InputSnapshot,
): number {
  const raw = resolveNumberBinding(weight, 1, inputs);
  if (!Number.isFinite(raw)) return 1;
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}
