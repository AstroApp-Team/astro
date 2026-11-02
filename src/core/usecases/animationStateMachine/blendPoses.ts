/**
 * Pose blending (§9.1, §8.3).
 *
 * Two entry points, because the two jobs are not the same operation:
 *
 * - `blendPoses` blends **two complete poses** by an eased fraction. A transition uses
 *   it, and the fraction it passes is `blendFraction(sourceProgress, fadeEasing)` —
 *   never `elapsed / duration`, which is the §8.3 bug this file exists to prevent.
 * - `applySample` writes **one state's sample** into an accumulator, with a weight, a
 *   mask, and an override-or-additive mode. Layer composition uses it.
 *
 * Both are mask-aware per channel. A mask weight of 0.5 on `spine.rotationQuat` blends
 * half a rotation and leaves `spine.position` at full weight, which is the whole point
 * of a channel filter.
 */

import type { BoneTransform, MachineOutput } from "@core/models/animationStateMachine.ts";
import {
  additiveDelta,
  blendBone,
  blendMorph,
  clamp,
  composeBone,
  morphsByMesh,
} from "@core/usecases/animationStateMachine/mathUtil.ts";
import {
  maskBoneWeight,
  maskMorphWeight,
} from "@core/usecases/animationStateMachine/maskResolver.ts";
import type { ResolvedMask } from "@core/usecases/animationStateMachine/maskResolver.ts";
import type { PoseAccumulator, StateSample } from "@core/usecases/animationStateMachine/types.ts";

export interface BlendOptions {
  rotationBlend: "slerp" | "nlerp";
  morphRange: [number, number];
}

/**
 * Blend two poses by `t`.
 *
 * `t` is the **blend fraction**, already eased. A bone present in only one side passes
 * through at the fraction that side contributes: a pose that animates three bones
 * blending in over a pose that animates forty leaves thirty-seven bones alone, which is
 * what a sparse sample means.
 */
export function blendPoses(
  from: PoseAccumulator,
  to: PoseAccumulator,
  t: number,
  mask: ResolvedMask,
  options: BlendOptions,
): PoseAccumulator {
  const bones = new Map<string, BoneTransform>();

  for (const [bone, fromTransform] of from.bones) {
    const toTransform = to.bones.get(bone);
    if (toTransform == null) {
      bones.set(bone, fromTransform);
      continue;
    }
    bones.set(
      bone,
      blendBoneWithMask(fromTransform, toTransform, t, bone, mask, options.rotationBlend),
    );
  }
  // A bone only the incoming pose animates enters at the incoming fraction, so a
  // transition does not pop a bone in at full weight.
  for (const [bone, toTransform] of to.bones) {
    if (from.bones.has(bone)) continue;
    bones.set(bone, blendBoneWithMask({}, toTransform, t, bone, mask, options.rotationBlend));
  }

  const morphs = new Map<string, number>();
  for (const [key, weight] of from.morphs) {
    const target = to.morphs.get(key);
    morphs.set(key, target == null ? weight : blendMorph(weight, target, t, options.morphRange));
  }
  for (const [key, weight] of to.morphs) {
    if (from.morphs.has(key)) continue;
    morphs.set(key, blendMorph(0, weight, t, options.morphRange));
  }

  return { bones, morphs, bonesDirty: true, morphsDirty: true };
}

function blendBoneWithMask(
  from: BoneTransform,
  to: BoneTransform,
  t: number,
  bone: string,
  mask: ResolvedMask,
  rotationBlend: "slerp" | "nlerp",
): BoneTransform {
  const positionWeight = maskBoneWeight(mask, bone, "position");
  const rotationWeight = maskBoneWeight(mask, bone, "rotationQuat");
  const scaleWeight = maskBoneWeight(mask, bone, "scale");

  const blended = blendBone(from, to, t, rotationBlend);
  const out: BoneTransform = {};

  if (blended.position != null) {
    out.position =
      positionWeight >= 1
        ? blended.position
        : blendVec(from.position ?? blended.position, blended.position, t * positionWeight);
  }
  if (blended.rotationQuat != null) {
    out.rotationQuat =
      rotationWeight >= 1
        ? blended.rotationQuat
        : (blendBone(from, to, t * rotationWeight, rotationBlend).rotationQuat ??
          blended.rotationQuat);
  }
  if (blended.scale != null) {
    out.scale =
      scaleWeight >= 1
        ? blended.scale
        : blendVec(from.scale ?? blended.scale, blended.scale, t * scaleWeight);
  }

  return out;
}

function blendVec(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/* ── Layer composition ───────────────────────────────────────────────── */

export interface ApplyOptions extends BlendOptions {
  blend: "override" | "additive";
  weight: number;
  mask: ResolvedMask;
  /** The `additiveRef` sample. Required for `blend: "additive"`. */
  reference?: StateSample;
}

/**
 * Write one state's sample into an accumulator.
 *
 * `override` blends toward the sample by `weight`. `additive` composes the delta
 * `sample ∘ reference⁻¹`, scaled by `weight`, onto the pose below it.
 *
 * A weight of 0 writes nothing, which is the property a layer weight slider depends on:
 * muting a layer must not change the pose below it, and blending toward a sample at
 * weight 0 is exactly that.
 */
export function applySample(
  target: PoseAccumulator,
  sample: StateSample,
  options: ApplyOptions,
): void {
  const weight = clamp(options.weight, 0, 1);
  if (weight <= 0) return;

  const isAdditive = options.blend === "additive";
  if (isAdditive && options.reference == null) return;

  for (const [bone, transform] of sample.bones) {
    const channelWeight = Math.max(
      maskBoneWeight(options.mask, bone, "position"),
      maskBoneWeight(options.mask, bone, "rotationQuat"),
      maskBoneWeight(options.mask, bone, "scale"),
    );
    if (channelWeight <= 0) continue;

    const contribution = isAdditive
      ? scaleDelta(
          additiveDelta(transform, options.reference?.bones.get(bone) ?? {}),
          weight * channelWeight,
        )
      : transform;

    const existing = target.bones.get(bone);
    if (isAdditive) {
      target.bones.set(bone, existing == null ? contribution : composeBone(existing, contribution));
    } else {
      target.bones.set(
        bone,
        existing == null
          ? blendBone({}, contribution, weight * channelWeight, options.rotationBlend)
          : blendBoneWithMask(
              existing,
              contribution,
              weight * channelWeight,
              bone,
              options.mask,
              options.rotationBlend,
            ),
      );
    }
    target.bonesDirty = true;
  }

  for (const [key, value] of sample.morphs) {
    const separator = key.indexOf(":");
    const mesh = key.slice(0, separator);
    const morphTarget = key.slice(separator + 1);
    const channelWeight = maskMorphWeight(options.mask, mesh, morphTarget);
    if (channelWeight <= 0) continue;

    const existing = target.morphs.get(key) ?? 0;
    const next = isAdditive
      ? clamp(
          existing + (value - (options.reference?.morphs.get(key) ?? 0)) * weight * channelWeight,
          options.morphRange[0],
          options.morphRange[1],
        )
      : blendMorph(existing, value, weight * channelWeight, options.morphRange);
    target.morphs.set(key, next);
    target.morphsDirty = true;
  }
}

/**
 * Scale an additive delta toward the identity by `weight`.
 *
 * A delta is a displacement, so scaling it is scaling the displacement: position and
 * scale are multiplied, rotation is slerped toward the identity. Multiplying quaternion
 * components is not a rotation and would produce a non-unit quaternion.
 */
function scaleDelta(delta: BoneTransform, weight: number): BoneTransform {
  const out: BoneTransform = {};
  if (delta.position != null)
    out.position = [
      delta.position[0] * weight,
      delta.position[1] * weight,
      delta.position[2] * weight,
    ];
  if (delta.rotationQuat != null) {
    // `blendBone` returns a partial transform, so the rotation it hands back can be
    // absent; writing an explicit undefined into `out.rotationQuat` is what
    // `exactOptionalPropertyTypes` rejects.
    const blended = blendBone({}, { rotationQuat: delta.rotationQuat }, weight).rotationQuat;
    if (blended != null) out.rotationQuat = blended;
  }
  if (delta.scale != null)
    out.scale = [delta.scale[0] * weight, delta.scale[1] * weight, delta.scale[2] * weight];
  return out;
}

/* ── Output ──────────────────────────────────────────────────────────── */

/**
 * The read-only view of an accumulator (§2.2: `createMachine` returns a `Machine` whose
 * `step` returns `MachineOutput`).
 *
 * `bones` is a plain record, not a Map: the adapter iterates it once per frame and a
 * Map forces a `.forEach` on the hot path for no benefit.
 */
export function toMachineOutput(pose: PoseAccumulator): MachineOutput {
  const bones: Record<string, BoneTransform> = {};
  for (const [bone, transform] of pose.bones) {
    bones[bone] = transform;
  }
  /* Zero root motion, not a missing field: this function composes a pose and knows nothing
     about bones moving the model, and `createMachine` overwrites the field when the
     definition names a `rootBone`. A machine without one therefore reports zero, which the
     host can add unconditionally. */
  return { bones, morphs: morphsByMesh(pose.morphs), rootMotion: { translation: [0, 0, 0] } };
}

export function emptyPose(): PoseAccumulator {
  return { bones: new Map(), morphs: new Map(), bonesDirty: true, morphsDirty: true };
}

export function clonePose(pose: PoseAccumulator): PoseAccumulator {
  const bones = new Map<string, BoneTransform>();
  for (const [bone, transform] of pose.bones) {
    bones.set(bone, blendBone({}, transform, 1));
  }
  return { bones, morphs: new Map(pose.morphs), bonesDirty: true, morphsDirty: true };
}
