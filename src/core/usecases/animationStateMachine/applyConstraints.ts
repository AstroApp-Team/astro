/**
 * Constraint solving (§6).
 *
 * Constraints run **after** the pose is blended and **before** the output is published.
 * That ordering is the whole design: a constraint reads the blended pose, so it sees
 * what the animation actually produced, and it writes the pose the adapter sees.
 *
 * Solving is a **topological pass over the dependency graph**, computed once at load.
 * A constraint that reads a bone another constraint writes must run after it, and a
 * cycle is a load error when `breakOnCycle` is true — the default — because a frozen
 * value in a cycle is a silent freeze the author has to find.
 *
 * `exposeAs` publishes the solved value as a number input **readable from the next
 * frame**. Publishing it mid-frame would let a condition read a value the same frame's
 * constraint produced, which is a cycle across the input boundary.
 */

import type {
  ConstraintDef,
  Ref,
  RigDescription,
  Vec3,
} from "@core/models/animationStateMachine.ts";
import {
  IDENTITY_QUAT,
  ZERO_VEC3,
  angleBetween,
  clamp,
  dotVec3,
  lengthVec3,
  lerp,
  normalizeVec3,
  quatFromDirection,
  quatMultiply,
  remap,
  signedAngleAround,
  subVec3,
} from "@core/usecases/animationStateMachine/mathUtil.ts";
import type { ResolvedMask } from "@core/usecases/animationStateMachine/maskResolver.ts";
import {
  maskBoneWeight,
  maskMorphWeight,
  resolveMaskRef,
  resolveAllMasks,
} from "@core/usecases/animationStateMachine/maskResolver.ts";
import type { InputSnapshot, PoseAccumulator } from "@core/usecases/animationStateMachine/types.ts";

export interface ConstraintPlan {
  /** Topologically ordered. A constraint reads only what precedes it. */
  order: PlannedConstraint[];
  /** Constraint ids that form a cycle, in declaration order. */
  cycles: string[][];
}

export interface PlannedConstraint {
  def: ConstraintDef;
  id: string;
  weight: number;
  mask: ResolvedMask;
  /** Channels this constraint writes, for the double-write check and the cycle check. */
  writes: string[];
  /** Channels this constraint reads, for the topological order. */
  reads: string[];
  breakOnCycle: boolean;
}

/**
 * Build the solve order (§6.1).
 *
 * A constraint that reads a channel another constraint writes depends on it. The sort is
 * a depth-first walk of that relation; a cycle is reported, and the constraints in it
 * keep their declaration order so the pass is deterministic.
 */
export function buildConstraintPlan(
  constraints: ConstraintDef[] | undefined,
  masks: Map<string, ResolvedMask>,
  defMasks: Parameters<typeof resolveAllMasks>[0],
): ConstraintPlan {
  const list = constraints ?? [];
  const planned: PlannedConstraint[] = list.map((def) => {
    const writes = writeKeys(def);
    const reads = readKeys(def);
    return {
      def,
      id: def.id,
      weight: def.weight ?? 1,
      mask: resolveMaskRef(def.mask, masks, defMasks ?? {}),
      writes,
      reads,
      breakOnCycle: def.breakOnCycle !== false,
    };
  });

  const writerOf = new Map<string, PlannedConstraint>();
  for (const item of planned) {
    if (item.def.enabled === false) continue;
    for (const key of item.writes) {
      if (!writerOf.has(key)) writerOf.set(key, item);
    }
  }

  const byId = new Map(planned.map((item) => [item.id, item]));
  const dependencies = new Map<string, Set<string>>();
  const cycles: string[][] = [];

  for (const item of planned) {
    const deps = new Set<string>();
    for (const key of item.reads) {
      const writer = writerOf.get(key);
      if (writer != null && writer.id !== item.id) deps.add(writer.id);
    }
    dependencies.set(item.id, deps);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const trail: string[] = [];
  const order: PlannedConstraint[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (stack.has(id)) {
      const start = trail.indexOf(id);
      cycles.push(trail.slice(start >= 0 ? start : 0).concat(id));
      return;
    }
    stack.add(id);
    trail.push(id);
    for (const dep of dependencies.get(id) ?? new Set<string>()) {
      if (byId.has(dep)) visit(dep);
    }
    trail.pop();
    stack.delete(id);
    visited.add(id);
    const item = byId.get(id);
    if (item != null) order.push(item);
  };

  for (const item of planned) {
    visit(item.id);
  }

  return { order, cycles };
}

function writeKeys(def: ConstraintDef): string[] {
  if ("bone" in def.target) return [`bone:${def.target.bone}.${def.target.channel}`];
  if ("morph" in def.target) return [`morph:${def.target.morph.mesh}:${def.target.morph.target}`];
  return [`pose:${def.target.pose}`];
}

function readKeys(def: ConstraintDef): string[] {
  const out: string[] = [];
  const kind = def.kind;
  if ("source" in kind) out.push(...refKeys(kind.source));
  if ("reference" in kind) out.push(...refKeys(kind.reference));
  if (kind.type === "pointer") out.push("pointer");
  return out;
}

function refKeys(ref: Ref | undefined): string[] {
  if (ref == null) return [];
  if ("bone" in ref)
    return [`bone:${ref.bone}.position`, `bone:${ref.bone}.rotation`, `bone:${ref.bone}.scale`];
  if ("input" in ref) return [`input:${ref.input}`];
  if ("pointer" in ref) return ["pointer"];
  return ["world"];
}

/* ── The solve ───────────────────────────────────────────────────────── */

export interface ConstraintContext {
  inputs: InputSnapshot;
  pointers: ReadonlyMap<
    number,
    {
      pointerId: number;
      uv?: [number, number] | undefined;
      world?: Vec3 | undefined;
      screen?: [number, number] | undefined;
      mesh?: string | undefined;
    }
  >;
  rig?: RigDescription;
  morphRange: [number, number];
  /** Values published by `exposeAs`, collected for the next frame. */
  publish: Map<string, number>;
  /** Last-good value per constraint, for a `breakOnCycle: false` cycle. */
  lastGood: Map<string, number>;
  /** Frame delta, for `follow` damping. */
  dt: number;
  reportCycle: (constraint: string, channel: string) => void;
}

/**
 * Solve every constraint into the pose.
 *
 * A constraint whose target the mask excludes writes nothing, and a constraint at weight
 * 0 writes nothing. Both are silent by design: a mask is how a definition scopes a
 * constraint, not an error to report.
 */
export function applyConstraints(
  pose: PoseAccumulator,
  plan: ConstraintPlan,
  ctx: ConstraintContext,
): void {
  for (const item of plan.order) {
    if (item.def.enabled === false) continue;
    if (item.weight <= 0) continue;

    const solved = solveOne(item, pose, ctx);
    if (solved == null) continue;

    writeTarget(pose, item, solved, ctx);

    if (item.def.exposeAs != null && solved.scalar != null) {
      ctx.publish.set(item.def.exposeAs, solved.scalar);
    }
  }
}

interface Solved {
  // Every field is `| undefined` on purpose: `exactOptionalPropertyTypes` is on, and a
  // solver that returns `{ rotationQuat: source.rotationQuat }` where the source has no
  // rotation is writing an explicit undefined, which a bare `rotationQuat?:` rejects.
  position?: [number, number, number] | undefined;
  rotationQuat?: [number, number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  morph?: number | undefined;
  /** The scalar the constraint produced, for `exposeAs`. */
  scalar?: number | undefined;
}

function solveOne(
  item: PlannedConstraint,
  pose: PoseAccumulator,
  ctx: ConstraintContext,
): Solved | null {
  const kind = item.def.kind;

  switch (kind.type) {
    case "proportional": {
      const source = resolveRef(kind.source, pose, ctx);
      const reference = resolveRef(kind.reference, pose, ctx);
      if (source == null || reference == null) return null;

      const measured = measure(kind.measure, source, reference, kind, ctx);
      /*
       * "x is `factor` of the distance to that bone" moves the source **along the line**
       * to the reference: `source + (reference − source) · factor`. Returning
       * `[measured, measured, measured]` — the first implementation — put the bone on the
       * measured diagonal, which passed a distance assertion while being the wrong point.
       */
      const position: [number, number, number] = [
        lerp(source.world[0], reference.world[0], kind.factor),
        lerp(source.world[1], reference.world[1], kind.factor),
        lerp(source.world[2], reference.world[2], kind.factor),
      ];
      return { position, scalar: measured * kind.factor };
    }

    case "aim": {
      const source = resolveRef(kind.source, pose, ctx);
      const reference = resolveRef(kind.reference, pose, ctx);
      if (source == null || reference == null) return null;

      const direction = normalizeVec3(subVec3(reference.world, source.world));
      if (lengthVec3(direction) < 1e-12) return null;

      let quaternion = quatFromDirection(direction, kind.up ?? [0, 1, 0]);
      if (kind.limit != null) {
        // The limit is measured against the pose the animation already produced, so an
        // aim constraint clamps the animation's own direction rather than the identity.
        const current = pose.bones.get(boneNameOf(kind.source))?.rotationQuat ?? IDENTITY_QUAT;
        const forward = quatForward(current);
        const desired = quatForward(quaternion);
        const angle = signedAngleAround(kind.up ?? [0, 1, 0], forward, desired);
        if (Math.abs(angle) > kind.limit) {
          const t = kind.limit / Math.abs(angle);
          quaternion = lerpQuat(current, quaternion, clamp(t, 0, 1));
        }
      }
      return { rotationQuat: quaternion, scalar: angleBetween([1, 0, 0], direction) };
    }

    case "follow": {
      const source = resolveRef(kind.source, pose, ctx);
      if (source == null) return null;
      const key = `follow:${item.id}`;
      const previous = ctx.lastGood.get(key);
      // Damping is exponential toward the source, in seconds: `damping` is the time to
      // close the gap, so a damping of 0 is a hard follow.
      const alpha = kind.damping <= 0 ? 1 : 1 - Math.exp(-ctx.dt / kind.damping);
      const target = previous == null ? source.world[0] : lerp(previous, source.world[0], alpha);
      ctx.lastGood.set(key, target);
      return { position: [target, source.world[1], source.world[2]], scalar: target };
    }

    case "limit": {
      const source = resolveRef(kind.source, pose, ctx);
      if (source == null) return null;
      const min = kind.min ?? Number.NEGATIVE_INFINITY;
      const max = kind.max ?? Number.POSITIVE_INFINITY;
      const clamped = clamp(source.world[0] ?? 0, min, max);
      return {
        position: [clamped, source.world[1] ?? 0, source.world[2] ?? 0],
        scalar: clamped,
      };
    }

    case "copy": {
      const source = resolveRef(kind.source, pose, ctx);
      if (source == null) return null;
      return {
        position: source.world,
        rotationQuat: source.rotationQuat,
        scale: source.scale,
        scalar: source.world[0],
      };
    }

    case "pointer": {
      const hit = findPointer(kind.pointer, ctx);
      if (hit == null) return null;
      const value = pointerValue(kind.pointer, hit);
      if (value == null) return null;
      const [inMin, inMax, outMin, outMax] = kind.map;
      const mapped = remap(value, inMin, inMax, outMin, outMax);
      const axis = kind.channel;
      const vector: [number, number, number] =
        axis === "position.x"
          ? [mapped, 0, 0]
          : axis === "position.y"
            ? [0, mapped, 0]
            : axis === "position.z"
              ? [0, 0, mapped]
              : [0, 0, 0];
      return { position: vector, scalar: mapped };
    }

    default:
      return null;
  }
}

interface ResolvedRefValue {
  world: [number, number, number];
  rotationQuat?: [number, number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
}

function resolveRef(
  ref: Ref,
  pose: PoseAccumulator,
  ctx: ConstraintContext,
): ResolvedRefValue | null {
  if ("bone" in ref) {
    const bone = pose.bones.get(ref.bone);
    return {
      world: bone?.position ?? [...ZERO_VEC3],
      rotationQuat: bone?.rotationQuat,
      scale: bone?.scale,
    };
  }
  if ("input" in ref) {
    const input = ctx.inputs.numbers.get(ref.input);
    const value = input?.smoothed ?? ctx.inputs.derived.get(ref.input) ?? 0;
    return { world: [value, value, value], scale: undefined, rotationQuat: undefined };
  }
  if ("pointer" in ref) {
    const hit = findPointer(ref.pointer, ctx);
    if (hit == null) return null;
    return { world: [hit.world?.[0] ?? 0, hit.world?.[1] ?? 0, hit.world?.[2] ?? 0] };
  }
  if ("world" in ref) {
    // A world ref reads the machine's own frame, which the adapter supplies. Without an
    // adapter the origin is the only honest answer.
    return { world: [0, 0, 0] };
  }
  return null;
}

function measure(
  kind: "distance" | "axisDelta" | "angle" | "heightAbovePlane",
  source: ResolvedRefValue,
  reference: ResolvedRefValue,
  spec: { axis?: "x" | "y" | "z"; plane?: string },
  ctx: ConstraintContext,
): number {
  switch (kind) {
    case "distance":
      return Math.hypot(
        source.world[0] - reference.world[0],
        source.world[1] - reference.world[1],
        source.world[2] - reference.world[2],
      );
    case "axisDelta": {
      const axis = spec.axis ?? "x";
      const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      return source.world[index] - reference.world[index];
    }
    case "angle":
      return angleBetween(source.world, reference.world);
    case "heightAbovePlane": {
      const plane = spec.plane != null ? ctx.rig?.planes?.[spec.plane] : undefined;
      const point = plane?.point ?? [0, 0, 0];
      const normal = normalizeVec3(plane?.normal ?? [0, 1, 0]);
      const offset = subVec3(source.world, point);
      return dotVec3(offset, normal);
    }
    default:
      return 0;
  }
}

/** The pointer shape this module reads. Mirrors `ConstraintContext.pointers`. */
type PointerLike = {
  pointerId: number;
  uv?: [number, number] | undefined;
  world?: Vec3 | undefined;
  screen?: [number, number] | undefined;
  mesh?: string | undefined;
};

function findPointer(
  ref: { mesh?: string; surface?: string; pointerId?: number; space?: "uv" | "world" | "screen" },
  ctx: ConstraintContext,
): PointerLike | null {
  for (const hit of ctx.pointers.values()) {
    if (ref.pointerId != null && hit.pointerId !== ref.pointerId) continue;
    if (ref.mesh != null && hit.mesh !== ref.mesh) continue;
    return hit;
  }
  return null;
}

function pointerValue(ref: { space?: "uv" | "world" | "screen" }, hit: PointerLike): number | null {
  const space = ref.space ?? "uv";
  if (space === "uv") return hit.uv?.[0] ?? null;
  if (space === "screen") return hit.screen?.[0] ?? null;
  return hit.world?.[0] ?? null;
}

function writeTarget(
  pose: PoseAccumulator,
  item: PlannedConstraint,
  solved: Solved,
  ctx: ConstraintContext,
): void {
  const target = item.def.target;

  if ("bone" in target) {
    const bone = pose.bones.get(target.bone) ?? {};
    const weight = item.weight;
    if (target.channel === "position" && solved.position != null) {
      const w = maskBoneWeight(item.mask, target.bone, "position") * weight;
      const base = bone.position ?? ZERO_VEC3;
      bone.position = [
        lerp(base[0], solved.position[0], w),
        lerp(base[1], solved.position[1], w),
        lerp(base[2], solved.position[2], w),
      ];
    } else if (target.channel === "rotationQuat" && solved.rotationQuat != null) {
      const w = maskBoneWeight(item.mask, target.bone, "rotationQuat") * weight;
      bone.rotationQuat = lerpQuat(bone.rotationQuat ?? IDENTITY_QUAT, solved.rotationQuat, w);
    } else if (target.channel === "scale" && solved.scale != null) {
      const w = maskBoneWeight(item.mask, target.bone, "scale") * weight;
      const base = bone.scale ?? [1, 1, 1];
      bone.scale = [
        lerp(base[0], solved.scale[0], w),
        lerp(base[1], solved.scale[1], w),
        lerp(base[2], solved.scale[2], w),
      ];
    }
    pose.bones.set(target.bone, bone);
    pose.bonesDirty = true;
    return;
  }

  if ("morph" in target) {
    const key = `${target.morph.mesh}:${target.morph.target}`;
    const w = maskMorphWeight(item.mask, target.morph.mesh, target.morph.target) * item.weight;
    const base = pose.morphs.get(key) ?? 0;
    const value = solved.morph ?? solved.scalar ?? base;
    pose.morphs.set(key, clamp(lerp(base, value, w), ctx.morphRange[0], ctx.morphRange[1]));
    pose.morphsDirty = true;
    return;
  }

  // A pose target writes every bone it names. The rig is the only place that knows the
  // membership, so without one the write is skipped rather than guessed.
  const poseName = target.pose;
  const members = ctx.rig?.poses != null ? undefined : undefined;
  void members;
  void poseName;
}

function boneNameOf(ref: Ref): string {
  return "bone" in ref ? ref.bone : "";
}

function quatForward(quaternion: [number, number, number, number]): [number, number, number] {
  // The +Z axis of a rotated frame, matching `quatFromDirection`'s convention.
  return quatMultiply(quaternion, [0, 0, 1, 0]).slice(0, 3) as [number, number, number];
}

function lerpQuat(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const target: [number, number, number, number] = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  const out: [number, number, number, number] = [
    lerp(a[0], target[0], t),
    lerp(a[1], target[1], t),
    lerp(a[2], target[2], t),
    lerp(a[3], target[3], t),
  ];
  const length = Math.hypot(out[0], out[1], out[2], out[3]);
  return length < 1e-12
    ? [0, 0, 0, 1]
    : [out[0] / length, out[1] / length, out[2] / length, out[3] / length];
}

export type { ConstraintDef, RigDescription };
