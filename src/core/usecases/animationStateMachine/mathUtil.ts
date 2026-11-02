/**
 * The pose algebra (§12).
 *
 * Three.js owns these operations at runtime — the adapter hands `MachineOutput.bones`
 * to `Object3D`, and `THREE.Quaternion.slerp` does the work. This file exists so
 * `blendPoses` has an implementation the tests can run, and so the core has no
 * dependency on three.js at all.
 *
 * Two conventions the rest of the feature depends on:
 *
 * - A **missing channel is the identity**, not zero. A missing rotation is "no
 *   rotation"; a missing position is "the bind position". Blending toward a pose that
 *   omits a channel leaves the channel below it untouched.
 * - Morph weights are clamped to the machine's `morphRange` on write, never on read,
 *   so a blend of two out-of-range weights is not silently renormalised.
 */

import type {
  BoneTransform,
  MorphWeights,
  Quat,
  Vec3,
} from "@core/models/animationStateMachine.ts";

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];
export const ZERO_VEC3: Vec3 = [0, 0, 0];

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    lerp(a[0] ?? 0, b[0] ?? 0, t),
    lerp(a[1] ?? 0, b[1] ?? 0, t),
    lerp(a[2] ?? 0, b[2] ?? 0, t),
  ];
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function lengthVec3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalizeVec3(a: Vec3): Vec3 {
  const len = lengthVec3(a);
  return len < 1e-12 ? [0, 0, 0] : [a[0] / len, a[1] / len, a[2] / len];
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Angle between two vectors in radians. Zero-length inputs read 0, never NaN. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = lengthVec3(a);
  const lb = lengthVec3(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  return Math.acos(clamp(dotVec3(a, b) / (la * lb), -1, 1));
}

/** Signed angle around `axis`, for a 2D aim limit. */
export function signedAngleAround(axis: Vec3, from: Vec3, to: Vec3): number {
  const angle = angleBetween(from, to);
  const side = dotVec3(axis, crossVec3(from, to));
  return side < 0 ? -angle : angle;
}

/* ── Quaternion algebra ──────────────────────────────────────────────── */

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + ay * bz - az * by + aw * bx,
    -ax * bz + ay * bw + az * bx + aw * by,
    ax * by - ay * bx + az * bw + aw * bz,
    -ax * bx - ay * by - az * bz + aw * bw,
  ];
}

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len < 1e-12 ? [...IDENTITY_QUAT] : [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatDot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/**
 * Shortest-arc slerp. The dot is clamped and the sign flipped when it is negative,
 * which is the whole of "shortest arc": without it a 180° rotation takes the long way
 * and the sphere turns inside out for half the fade.
 */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  if (t <= 0) return [...a];
  if (t >= 1) return [...b];

  let dot = quatDot(a, b);
  let target = b;
  if (dot < 0) {
    dot = -dot;
    target = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (dot > 0.9995) {
    // Nearly parallel: slerp's denominator collapses, lerp + normalize is exact here.
    return quatNormalize([
      lerp(a[0], target[0], t),
      lerp(a[1], target[1], t),
      lerp(a[2], target[2], t),
      lerp(a[3], target[3], t),
    ]);
  }

  const theta = Math.acos(clamp(dot, -1, 1));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return [
    a[0] * wa + target[0] * wb,
    a[1] * wa + target[1] * wb,
    a[2] * wa + target[2] * wb,
    a[3] * wa + target[3] * wb,
  ];
}

/** Normalized lerp. Cheaper than slerp, visibly wrong past ~90° (§12). */
export function quatNlerp(a: Quat, b: Quat, t: number): Quat {
  const dot = quatDot(a, b);
  const target: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  return quatNormalize([
    lerp(a[0], target[0], t),
    lerp(a[1], target[1], t),
    lerp(a[2], target[2], t),
    lerp(a[3], target[3], t),
  ]);
}

/**
 * Quaternion from a direction. Used by `aim` and by `axisDelta`. `up` resolves the
 * roll; without it a bone pointing straight up has no defined twist.
 */
export function quatFromDirection(direction: Vec3, up: Vec3 = [0, 1, 0]): Quat {
  const d = normalizeVec3(direction);
  if (lengthVec3(d) < 1e-12) return [...IDENTITY_QUAT];

  // The bone's local axis is +Z, matching three.js `Object3D.lookAt`'s convention.
  const forward: Vec3 = [0, 0, 1];
  const axis = crossVec3(forward, d);
  const axisLength = lengthVec3(axis);
  if (axisLength < 1e-9) {
    // Parallel to +Z: the only remaining case is the 180° flip, whose axis is `up`.
    const dotForward = dotVec3(forward, d);
    if (dotForward > 0) return [...IDENTITY_QUAT];
    const flip = normalizeVec3(crossVec3(up, forward));
    const fallback = lengthVec3(flip) < 1e-9 ? ([1, 0, 0] as Vec3) : flip;
    // 180° about `fallback`: cos(90°) = 0, so w = 0 and xyz = the axis.
    return quatNormalize([fallback[0], fallback[1], fallback[2], 0]);
  }

  const angle = angleBetween(forward, d);
  const axisNorm = scaleVec3(axis, 1 / axisLength);
  const half = angle / 2;
  const s = Math.sin(half);
  return quatNormalize([axisNorm[0] * s, axisNorm[1] * s, axisNorm[2] * s, Math.cos(half)]);
}

/* ── Bone transform algebra ──────────────────────────────────────────── */

/**
 * Compose two transforms: `a ∘ b`, i.e. apply `b` in the space `a` produces.
 *
 * A missing channel is the identity, so `composePoses(base, additive)` leaves a base
 * channel alone when the additive side does not name it.
 */
export function composeBone(a: BoneTransform, b: BoneTransform): BoneTransform {
  const out: BoneTransform = {};

  if (a.position != null || b.position != null) {
    const base = a.position ?? ZERO_VEC3;
    out.position = b.position == null ? [...base] : addVec3(base, b.position);
  }
  if (a.rotationQuat != null || b.rotationQuat != null) {
    const base = a.rotationQuat ?? IDENTITY_QUAT;
    out.rotationQuat = b.rotationQuat == null ? [...base] : quatMultiply(base, b.rotationQuat);
  }
  if (a.scale != null || b.scale != null) {
    const base = a.scale ?? [1, 1, 1];
    out.scale =
      b.scale == null
        ? [...base]
        : [
            base[0] * (b.scale?.[0] ?? 1),
            base[1] * (b.scale?.[1] ?? 1),
            base[2] * (b.scale?.[2] ?? 1),
          ];
  }

  return out;
}

/**
 * The additive delta `sample ∘ reference⁻¹` (§9.1).
 *
 * Position and scale are **not** conjugated by the reference rotation: a delta measured
 * in the reference's own rotated space lands in the wrong direction the moment the
 * reference is not axis-aligned. Position and scale are component-wise; only rotation
 * is conjugated, which is the only place a rotation inverse is meaningful.
 */
export function additiveDelta(sample: BoneTransform, reference: BoneTransform): BoneTransform {
  const out: BoneTransform = {};

  if (sample.position != null) {
    out.position = subVec3(sample.position, reference.position ?? ZERO_VEC3);
  }
  if (sample.rotationQuat != null) {
    out.rotationQuat = quatMultiply(
      sample.rotationQuat,
      quatConjugate(reference.rotationQuat ?? IDENTITY_QUAT),
    );
  }
  if (sample.scale != null) {
    const ref = reference.scale ?? [1, 1, 1];
    out.scale = [sample.scale[0] - ref[0], sample.scale[1] - ref[1], sample.scale[2] - ref[2]];
  }

  return out;
}

/**
 * Blend two bone transforms. `t` is the blend fraction, already eased by the caller —
 * this function never applies a curve, because §8.3 puts the curve on the source
 * progress, not on the blend.
 */
export function blendBone(
  a: BoneTransform,
  b: BoneTransform,
  t: number,
  rotationBlend: "slerp" | "nlerp" = "slerp",
): BoneTransform {
  if (t <= 0) return cloneBone(a);
  if (t >= 1) return cloneBone(b);

  const out: BoneTransform = {};
  if (a.position != null || b.position != null) {
    out.position = lerpVec3(a.position ?? ZERO_VEC3, b.position ?? ZERO_VEC3, t);
  }
  if (a.rotationQuat != null || b.rotationQuat != null) {
    const from = a.rotationQuat ?? IDENTITY_QUAT;
    const to = b.rotationQuat ?? IDENTITY_QUAT;
    out.rotationQuat = rotationBlend === "nlerp" ? quatNlerp(from, to, t) : quatSlerp(from, to, t);
  }
  if (a.scale != null || b.scale != null) {
    out.scale = lerpVec3(a.scale ?? [1, 1, 1], b.scale ?? [1, 1, 1], t);
  }

  return out;
}

export function cloneBone(bone: BoneTransform): BoneTransform {
  const out: BoneTransform = {};
  if (bone.position != null) out.position = [...bone.position];
  if (bone.rotationQuat != null) out.rotationQuat = [...bone.rotationQuat];
  if (bone.scale != null) out.scale = [...bone.scale];
  return out;
}

/* ── Morph algebra ───────────────────────────────────────────────────── */

export function blendMorph(
  a: number,
  b: number,
  t: number,
  range: [number, number] = [0, 1],
): number {
  return clamp(lerp(a, b, t), range[0], range[1]);
}

/** Flatten a sparse morph map into the public `MorphWeights[]` shape, grouped by mesh. */
export function morphsByMesh(morphs: ReadonlyMap<string, number>): MorphWeights[] {
  const byMesh = new Map<string, Record<string, number>>();
  for (const [key, weight] of morphs) {
    const separator = key.indexOf(":");
    if (separator <= 0) continue;
    const mesh = key.slice(0, separator);
    const target = key.slice(separator + 1);
    const bucket = byMesh.get(mesh);
    if (bucket == null) {
      byMesh.set(mesh, { [target]: weight });
    } else {
      bucket[target] = weight;
    }
  }
  return [...byMesh.entries()].map(([mesh, weights]) => ({ mesh, weights }));
}

/* ── Axis helpers ────────────────────────────────────────────────────── */

export function axisOf(vec: Vec3, axis: "x" | "y" | "z"): number {
  return axis === "x" ? vec[0] : axis === "y" ? vec[1] : vec[2];
}

/**
 * Map a value from one range onto another. `inMin === inMax` returns the output
 * midpoint: a degenerate input range is a constant, and dividing by zero is not.
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return (outMin + outMax) / 2;
  const t = (value - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, t);
}
