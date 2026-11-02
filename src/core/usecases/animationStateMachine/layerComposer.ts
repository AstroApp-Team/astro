/**
 * Layer composition (§7, §11.2).
 *
 * The frame's shape: every enabled layer produces one sample, the samples are written
 * into **one** accumulator from the lowest priority up, and the constraints then solve
 * over the result. Two properties follow from that order, and both are load bearing:
 *
 * - **Sparse in, sparse out.** A layer that animates three bones leaves the other
 *   thirty-seven alone, because `applySample` only writes the keys it was given. A dense
 *   sample of identity values would erase the layer below it, which is the classic way a
 *   blend tree "loses" its lower body.
 * - **Weight 0 writes nothing.** Muting a layer has to be the identity operation, not
 *   "blend toward the sample at 0" — those differ the moment a sample is sparse.
 *
 * Masks intersect rather than union: a layer masked to `legs` inside a constraint masked
 * to `arms` writes nothing, and that silence is the feature.
 */

import type { AssetResolver } from "@core/interfaces/animationAssets.ts";
import type {
  LayerDef,
  MachineDefinition,
  MachineOutput,
} from "@core/models/animationStateMachine.ts";
import { applySample, toMachineOutput } from "@core/usecases/animationStateMachine/blendPoses.ts";
import type {
  ConstraintContext,
  ConstraintPlan,
} from "@core/usecases/animationStateMachine/applyConstraints.ts";
import { applyConstraints } from "@core/usecases/animationStateMachine/applyConstraints.ts";
import { resolveWeight } from "@core/usecases/animationStateMachine/conditionEval.ts";
import {
  intersectMasks,
  OPEN_MASK,
  resolveMaskRef,
} from "@core/usecases/animationStateMachine/maskResolver.ts";
import type { ResolvedMask } from "@core/usecases/animationStateMachine/maskResolver.ts";
import { emptyPose } from "@core/usecases/animationStateMachine/blendPoses.ts";
import { sampleState } from "@core/usecases/animationStateMachine/sampleState.ts";
import type { SampleContext } from "@core/usecases/animationStateMachine/sampleState.ts";
import { createCursor } from "@core/usecases/animationStateMachine/timelineCursor.ts";
import type {
  InputSnapshot,
  LayerRuntime,
  PoseAccumulator,
  StateSample,
} from "@core/usecases/animationStateMachine/types.ts";

export interface ComposeOptions {
  definition: MachineDefinition;
  /** The layer definitions, in declaration order. Priority decides, not order. */
  layers: readonly LayerDef[];
  /** Live state per layer, keyed by `layerId`. */
  runtimes: ReadonlyMap<string, LayerRuntime>;
  /** One sample per layer, produced by `advanceLayerFrame`. */
  samples: ReadonlyMap<string, StateSample>;
  inputs: InputSnapshot;
  resolver: AssetResolver;
  /** The frame's sampling context, used for additive references and nothing else. */
  sampleCtx: SampleContext;
  /** Masks resolved once at load, already keyed by **layer id**. */
  layerMasks: ReadonlyMap<string, ResolvedMask>;
  rotationBlend: "slerp" | "nlerp";
  morphRange: [number, number];
  constraintPlan: ConstraintPlan | null;
  constraints: ConstraintContext;
}

/**
 * Compose every layer into one pose and solve the constraints over it.
 *
 * Layers are ordered by `priority` ascending, so the highest-priority layer is written
 * last and wins — the alternative (declaration order) would make moving a layer in the
 * file a silent behaviour change.
 */
export function composeFrame(options: ComposeOptions): {
  pose: PoseAccumulator;
  output: MachineOutput;
  weights: Map<string, number>;
} {
  const pose = emptyPose();
  const weights = new Map<string, number>();

  const ordered = [...options.layers].sort((a, b) => a.priority - b.priority);

  for (const layer of ordered) {
    const runtime = options.runtimes.get(layer.id);
    const sample = options.samples.get(layer.id);
    if (runtime == null || sample == null) continue;
    if (!runtime.enabled) continue;

    const weight = layerWeight(layer, runtime, options.inputs);
    weights.set(layer.id, weight);
    if (weight <= 0) continue;

    const mask = options.layerMasks.get(layer.id) ?? OPEN_MASK;
    const reference = layer.blend === "additive" ? additiveReference(layer, options) : undefined;

    applySample(pose, sample, {
      blend: layer.blend,
      weight,
      mask,
      rotationBlend: options.rotationBlend,
      morphRange: options.morphRange,
      ...(reference == null ? {} : { reference }),
    });
  }

  if (options.constraintPlan != null && options.constraintPlan.order.length > 0) {
    applyConstraints(pose, options.constraintPlan, options.constraints);
  }

  return { pose, output: toMachineOutput(pose), weights };
}

/** A layer's effective weight: the override wins over the declared binding. */
export function layerWeight(layer: LayerDef, runtime: LayerRuntime, inputs: InputSnapshot): number {
  if (runtime.weightOverride != null) {
    return Math.min(Math.max(runtime.weightOverride, 0), 1);
  }
  return resolveWeight(layer.weight, inputs);
}

/**
 * Resolve every layer's mask once, keyed by layer id.
 *
 * An inline mask is resolved **through the definition's table** so its `extends` still
 * reach a named mask; resolving it against an empty table silently turns `extends` into
 * "nothing", which reads as a layer that stopped contributing.
 */
export function resolveLayerMasks(
  definition: MachineDefinition,
  masks: ReadonlyMap<string, ResolvedMask>,
  groups: {
    bones: ReadonlyMap<string, string[]>;
    morph: ReadonlyMap<string, string[]>;
  },
): Map<string, ResolvedMask> {
  const out = new Map<string, ResolvedMask>();
  for (const layer of definition.layers) {
    if (layer.mask == null) continue;
    if (typeof layer.mask === "string") {
      const named = masks.get(layer.mask);
      if (named != null) out.set(layer.id, named);
      continue;
    }
    out.set(
      layer.id,
      resolveMaskRef(
        layer.mask,
        masks as Map<string, ResolvedMask>,
        definition.masks ?? {},
        groups,
      ),
    );
  }
  return out;
}

/**
 * The sample an additive layer is a delta against.
 *
 * `additiveRef` names a clip, a morph curve or a timeline — anything resolvable to a
 * pose — and the reference is sampled **once at time zero**, not per frame: an additive
 * layer's delta is measured against the rest pose, so a moving reference would turn the
 * delta into a second animation fighting the first.
 */
function additiveReference(layer: LayerDef, options: ComposeOptions): StateSample | undefined {
  const id = layer.additiveRef;
  if (id == null) return undefined;

  /*
   * The reference is sampled as a clip **at time zero**. A rest pose is the only reading
   * that makes `sample ∘ ref⁻¹` a delta: sample the reference at the current time and the
   * delta becomes a second animation, fighting the one the layer is trying to add to.
   *
   * A synthetic clip state is how a bare asset id gets through `sampleState` — the sampler
   * is state-shaped, and inventing a second code path for "one clip at one time" would be
   * a second place for the channel interpolation to drift.
   */
  const probe = { id: "__additiveRef__", type: "clip" as const, clip: id };
  const cursor = createCursor(undefined, 1, 0, options.sampleCtx.rng);
  const sample = sampleState(probe, cursor, options.sampleCtx);
  if (sample.bones.size === 0 && sample.morphs.size === 0) {
    /* An unresolvable reference is not a delta against anything; the validator reports the
       missing asset, so this stays silent rather than writing a bogus pose. */
    return undefined;
  }
  return sample;
}

/* ── Re-exports the facade and tests reach for ───────────────────────── */

export { intersectMasks };
export type { ResolvedMask };
