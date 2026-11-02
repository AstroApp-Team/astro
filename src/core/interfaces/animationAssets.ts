/**
 * Asset access (§11.1).
 *
 * The machine never loads anything. It asks for a clip by id and gets a typed array
 * back, or `null`. That is the seam: a browser fetch, a bundled JSON file and a test
 * fixture are all the same `AssetResolver`, and the runtime cannot tell them apart.
 *
 * `ClipAsset` is a flat typed array, not an array of keyframe objects. The runtime
 * samples by index arithmetic, so the shape that arrives from a DAE, from a JSON
 * fixture and from a hand-authored test must all be the same flat layout. A keyframe
 * object per channel would allocate on every sample.
 */

import type { MorphWeights, Vec3 } from "@core/models/animationStateMachine.ts";

/**
 * One channel of one bone, as a flat triple of (time, value, value, value).
 *
 * `times` is strictly increasing. `values` is flat: for `position` and `scale` it is
 * `times.length * 3`, for `rotationQuat` it is `times.length * 4`. A bone with no
 * translation track is absent, not zero-filled — the accumulator stays sparse.
 */
export interface BoneChannelAsset {
  bone: string;
  channel: "position" | "rotationQuat" | "scale";
  /** Strictly increasing, in seconds. */
  times: Float32Array;
  /** Flat. Stride is 3 for position/scale, 4 for rotationQuat. */
  values: Float32Array;
}

export interface MorphChannelAsset {
  mesh: string;
  target: string;
  times: Float32Array;
  values: Float32Array;
}

export interface ClipAsset {
  id: string;
  /** Seconds. The authority for normalised time on every state that references it. */
  duration: number;
  bones: BoneChannelAsset[];
  morphs: MorphChannelAsset[];
  /** Present when the clip was baked against a bind pose the adapter must restore. */
  bindPose?: Record<string, Vec3>;
}

export interface MorphCurveAsset {
  id: string;
  duration: number;
  morphs: MorphChannelAsset[];
}

/**
 * The resolver is read-only and synchronous. A machine that needs to await an asset
 * loads it before `createMachine`, because `step` is called from a render loop and
 * cannot become async.
 */
export interface AssetResolver {
  clip(id: string): ClipAsset | null;
  morphCurve(id: string): MorphCurveAsset | null;
}

/** The stride a channel's flat values use. */
export const CHANNEL_STRIDE: Record<BoneChannelAsset["channel"], number> = {
  position: 3,
  rotationQuat: 4,
  scale: 3,
};

/**
 * A resolver over a fixed set of assets. The test suite and the Studio's dev-save path
 * both use it; a production resolver wraps a fetch in the same shape.
 */
export function staticResolver(
  clips: ClipAsset[],
  morphCurves: MorphCurveAsset[] = [],
): AssetResolver {
  const byClip = new Map(clips.map((clip) => [clip.id, clip]));
  const byCurve = new Map(morphCurves.map((curve) => [curve.id, curve]));
  return {
    clip: (id) => byClip.get(id) ?? null,
    morphCurve: (id) => byCurve.get(id) ?? null,
  };
}

export type { MorphWeights };
