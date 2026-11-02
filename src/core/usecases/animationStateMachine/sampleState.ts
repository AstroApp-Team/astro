/**
 * State sampling (§9).
 *
 * One function, one state, one time. It returns a **sparse** sample: only the bones and
 * morphs the state's assets actually animate. Sparsity is what makes a 40-bone rig with
 * a 3-bone arm wave cost three bones, and it is what `blendPoses` and the mask layer
 * depend on — a dense sample of identity values would overwrite the pose below it.
 *
 * Blend spaces own their own cursors (§9.1). A blend1d with four children advances four
 * cursors, so a child clip can loop at its own rate while the blend input drives the
 * weights.
 */

import type { ClipAsset, MorphCurveAsset } from "@core/interfaces/animationAssets.ts";
import { CHANNEL_STRIDE } from "@core/interfaces/animationAssets.ts";
import type {
  BlendChild,
  BlendChild as BlendChildDef,
  ClipState,
  DirectState,
  MachineDefinition,
  StateDef,
} from "@core/models/animationStateMachine.ts";
import {
  additiveDelta,
  blendBone,
  blendMorph,
  clamp,
  lerp,
} from "@core/usecases/animationStateMachine/mathUtil.ts";
import type {
  InputSnapshot,
  Cursor,
  StateSample,
} from "@core/usecases/animationStateMachine/types.ts";

export interface SampleContext {
  inputs: InputSnapshot;
  resolver: { clip(id: string): ClipAsset | null; morphCurve(id: string): MorphCurveAsset | null };
  rng: () => number;
  epsilon: number;
  morphRange: [number, number];
  /** Cursors for blend children, keyed `stateId:index`. Owned by the layer runtime. */
  childCursors: Map<string, Cursor>;
}

/**
 * Sample one state at one time.
 *
 * `cursor` is the state's own cursor. For a blend space the children get cursors from
 * `ctx.childCursors`, created on first sample and advanced by the caller.
 */
export function sampleState(state: StateDef, cursor: Cursor, ctx: SampleContext): StateSample {
  switch (state.type) {
    case "clip":
      return sampleClipState(state, cursor, ctx);
    case "blend1d":
      return sampleBlend1d(state, cursor, ctx);
    case "blend2d":
      return sampleBlend2d(state, cursor, ctx);
    case "direct":
      return sampleDirect(state, ctx);
    case "exit":
      return emptySample();
    default:
      return emptySample();
  }
}

export function emptySample(): StateSample {
  return { bones: new Map(), morphs: new Map(), markers: [], progress: 0, speed: 1 };
}

/* ── Clip states ─────────────────────────────────────────────────────── */

function sampleClipState(state: ClipState, cursor: Cursor, ctx: SampleContext): StateSample {
  const sample = emptySample();
  const duration = cursor.duration;
  const normalized = duration > 0 ? cursor.time / duration : 0;
  sample.progress = clamp(normalized, 0, 1);
  sample.speed = cursor.style.kind === "once" ? 1 : 1;
  sample.markers = state.markers ?? [];

  if (state.clip != null) {
    const clip = ctx.resolver.clip(state.clip);
    if (clip != null) sampleClip(clip, cursor.time, sample, ctx);
  }
  if (state.morphCurve != null) {
    const curve = ctx.resolver.morphCurve(state.morphCurve);
    if (curve != null) sampleMorphCurve(curve, cursor.time, sample, ctx);
  }

  return sample;
}

/**
 * Sample a clip at `time` seconds.
 *
 * The index search is a **linear scan from a cached cursor**, not a binary search: clip
 * playback is monotonic in the overwhelmingly common case, and a scan that starts where
 * the last sample stopped is one comparison per frame. A seek backwards falls back to a
 * binary search, which the caller triggers by resetting the cached index.
 */
export function sampleClip(
  clip: ClipAsset,
  time: number,
  into: StateSample,
  ctx: SampleContext,
): void {
  for (const channel of clip.bones) {
    const stride = CHANNEL_STRIDE[channel.channel];
    const index = findIndex(channel.times, time);
    if (index < 0) continue;

    const next = Math.min(index + 1, channel.times.length - 1);
    const t0 = channel.times[index] ?? 0;
    const t1 = channel.times[next] ?? t0;
    const span = t1 - t0;
    const alpha = span > 0 ? clamp((time - t0) / span, 0, 1) : 0;

    const value = readChannelValue(channel.values, index, next, alpha, stride);
    if (value == null) continue;

    const existing = into.bones.get(channel.bone);
    const merged = existing ?? {};
    // `readChannelValue` returns a flat slice of the channel's interleaved buffer, so it
    // is a `number[]`; the transform wants fixed tuples, and `noUncheckedIndexedAccess`
    // makes every read an `number | undefined` that has to be defaulted.
    if (channel.channel === "position") {
      merged.position = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
    } else if (channel.channel === "scale") {
      merged.scale = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
    } else {
      merged.rotationQuat = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
    }
    into.bones.set(channel.bone, merged);
  }

  for (const morph of clip.morphs) {
    const index = findIndex(morph.times, time);
    if (index < 0) continue;
    const next = Math.min(index + 1, morph.times.length - 1);
    const t0 = morph.times[index] ?? 0;
    const t1 = morph.times[next] ?? t0;
    const span = t1 - t0;
    const alpha = span > 0 ? clamp((time - t0) / span, 0, 1) : 0;
    const weight = clamp(
      lerp(morph.values[index * 1] ?? 0, morph.values[next * 1] ?? 0, alpha),
      ctx.morphRange[0],
      ctx.morphRange[1],
    );
    into.morphs.set(`${morph.mesh}:${morph.target}`, weight);
  }
}

function sampleMorphCurve(
  curve: MorphCurveAsset,
  time: number,
  into: StateSample,
  ctx: SampleContext,
): void {
  for (const morph of curve.morphs) {
    const index = findIndex(morph.times, time);
    if (index < 0) continue;
    const next = Math.min(index + 1, morph.times.length - 1);
    const t0 = morph.times[index] ?? 0;
    const t1 = morph.times[next] ?? t0;
    const span = t1 - t0;
    const alpha = span > 0 ? clamp((time - t0) / span, 0, 1) : 0;
    into.morphs.set(
      `${morph.mesh}:${morph.target}`,
      clamp(
        lerp(morph.values[index] ?? 0, morph.values[next] ?? 0, alpha),
        ctx.morphRange[0],
        ctx.morphRange[1],
      ),
    );
  }
}

/**
 * Index of the last keyframe at or before `time`. `-1` when the clip has not started,
 * which is what makes a clip sampled before its first keyframe contribute nothing
 * instead of contributing its first pose.
 */
export function findIndex(times: Float32Array, time: number): number {
  const last = times.length - 1;
  if (last < 0) return -1;
  if (time < (times[0] ?? 0)) return -1;
  if (time >= (times[last] ?? 0)) return last;

  // Binary search. A linear scan from a cached index is an optimisation for a later
  // pass; correctness comes first, and a 200-key clip is 8 comparisons.
  let low = 0;
  let high = last;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((times[mid] ?? 0) <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}

function readChannelValue(
  values: Float32Array,
  index: number,
  next: number,
  alpha: number,
  stride: number,
): number[] | null {
  const base = index * stride;
  const far = next * stride;
  if (base + stride > values.length || far + stride > values.length) return null;
  const out: number[] = [];
  for (let i = 0; i < stride; i += 1) {
    out.push(lerp(values[base + i] ?? 0, values[far + i] ?? 0, alpha));
  }
  return out;
}

/* ── Blend spaces (§9) ───────────────────────────────────────────────── */

function sampleBlend1d(
  state: Extract<StateDef, { type: "blend1d" }>,
  cursor: Cursor,
  ctx: SampleContext,
): StateSample {
  const input = ctx.inputs.numbers.get(state.input);
  const value = input?.smoothed ?? 0;
  const children = [...state.children].sort((a, b) => childPosition(a) - childPosition(b));

  const weights = weights1d(children.map(childPosition), value);
  const sample = emptySample();
  sample.progress = clamp(normalizedOf(cursor), 0, 1);
  sample.markers = state.markers ?? [];

  blendChildren(children, weights, cursor, state.id, ctx, sample);
  return sample;
}

function sampleBlend2d(
  state: Extract<StateDef, { type: "blend2d" }>,
  cursor: Cursor,
  ctx: SampleContext,
): StateSample {
  const x = ctx.inputs.numbers.get(state.inputX)?.smoothed ?? 0;
  const y = ctx.inputs.numbers.get(state.inputY)?.smoothed ?? 0;
  const children = state.children;
  const points = children.map((child) => childPosition2d(child));

  const weights =
    state.algorithm === "grid"
      ? weightsGrid(points, x, y, state.gridSpacing)
      : weightsBarycentric(points, x, y);

  const sample = emptySample();
  sample.progress = clamp(normalizedOf(cursor), 0, 1);
  sample.markers = state.markers ?? [];
  blendChildren(children, weights, cursor, state.id, ctx, sample);
  return sample;
}

/**
 * Blend N child samples into one pose.
 *
 * Weights are normalised by their sum, and a sum of 0 leaves the sample empty: a blend
 * space whose input sits outside every child's influence contributes nothing, which is
 * the pose below it showing through. Renormalising a zero sum would invent a pose.
 */
function blendChildren(
  children: BlendChildDef[],
  weights: number[],
  cursor: Cursor,
  stateId: string,
  ctx: SampleContext,
  into: StateSample,
): void {
  let total = 0;
  for (const weight of weights) total += weight;
  if (total <= 0) return;

  const bones = new Map<string, ReturnType<typeof blendBone>>();
  const morphs = new Map<string, number>();

  children.forEach((child, index) => {
    const weight = (weights[index] ?? 0) / total;
    if (weight <= 0) return;

    const childCursor = childCursorFor(ctx, stateId, index, child, cursor);
    const childSample = sampleChild(child, childCursor, ctx);

    for (const [bone, transform] of childSample.bones) {
      const existing = bones.get(bone);
      bones.set(
        bone,
        existing == null
          ? blendBone(emptyBone(), transform, weight)
          : blendBone(existing, transform, weight),
      );
    }
    for (const [key, weight2] of childSample.morphs) {
      morphs.set(key, blendMorph(morphs.get(key) ?? 0, weight2, weight, ctx.morphRange));
    }
  });

  for (const [bone, transform] of bones) into.bones.set(bone, transform);
  for (const [key, weight] of morphs) into.morphs.set(key, weight);
}

function emptyBone() {
  return {};
}

function sampleChild(child: BlendChildDef, cursor: Cursor, ctx: SampleContext): StateSample {
  const sample = emptySample();
  if (child.clip != null) {
    const clip = ctx.resolver.clip(child.clip);
    if (clip != null) sampleClip(clip, cursor.time, sample, ctx);
  }
  if (child.morphCurve != null) {
    const curve = ctx.resolver.morphCurve(child.morphCurve);
    if (curve != null) sampleMorphCurve(curve, cursor.time, sample, ctx);
  }
  return sample;
}

/**
 * A blend child's cursor. Children advance with the state's cursor by default, and a
 * child with its own `speed` / `timeScale` advances at its own rate — which is the only
 * way an idle blend child keeps breathing while the input sits on it.
 */
function childCursorFor(
  ctx: SampleContext,
  stateId: string,
  index: number,
  child: BlendChildDef,
  parent: Cursor,
): Cursor {
  const key = `${stateId}:${String(index)}`;
  const existing = ctx.childCursors.get(key);
  if (existing != null) return existing;

  const duration =
    (child.clip != null ? ctx.resolver.clip(child.clip)?.duration : undefined) ?? parent.duration;
  const created: Cursor = {
    timelineId: parent.timelineId,
    time: 0,
    direction: 1,
    loops: 0,
    finished: false,
    style: { kind: "loop" },
    duration: duration > 0 ? duration : parent.duration,
  };
  ctx.childCursors.set(key, created);
  return created;
}

function normalizedOf(cursor: Cursor): number {
  return cursor.duration > 0 ? cursor.time / cursor.duration : 0;
}

function childPosition(child: BlendChildDef): number {
  const position = child.position;
  return Array.isArray(position) ? (position[0] ?? 0) : position;
}

function childPosition2d(child: BlendChildDef): [number, number] {
  const position = child.position;
  if (Array.isArray(position)) return [position[0] ?? 0, position[1] ?? 0];
  return [position, 0];
}

/**
 * 1D blend weights: linear between the two bracketing children, clamped at the ends.
 *
 * The clamp at the ends is what makes a blend1d a clamp and not an extrapolation: an
 * input past the last child holds the last pose.
 */
export function weights1d(positions: number[], value: number): number[] {
  const weights = new Array<number>(positions.length).fill(0);
  if (positions.length === 0) return weights;
  if (positions.length === 1) {
    weights[0] = 1;
    return weights;
  }

  if (value <= (positions[0] ?? 0)) {
    weights[0] = 1;
    return weights;
  }
  const lastIndex = positions.length - 1;
  if (value >= (positions[lastIndex] ?? 0)) {
    weights[lastIndex] = 1;
    return weights;
  }

  for (let i = 0; i < lastIndex; i += 1) {
    const a = positions[i] ?? 0;
    const b = positions[i + 1] ?? 0;
    if (value >= a && value <= b) {
      const span = b - a;
      const t = span > 0 ? (value - a) / span : 0;
      weights[i] = 1 - t;
      weights[i + 1] = t;
      return weights;
    }
  }

  weights[0] = 1;
  return weights;
}

/**
 * Barycentric weights over a 2D point set (§9).
 *
 * A Delaunay triangulation is built once per point set and cached by identity. Finding
 * the containing triangle is a point-in-triangle test over the triangle list, and the
 * barycentric coordinates of the point in that triangle are the weights — which is what
 * makes a 2D blend space continuous across triangle edges, the property a nearest-N
 * approximation does not have.
 */
export function weightsBarycentric(points: [number, number][], x: number, y: number): number[] {
  const weights = new Array<number>(points.length).fill(0);
  if (points.length === 0) return weights;
  if (points.length === 1) {
    weights[0] = 1;
    return weights;
  }
  if (points.length === 2) {
    const [a, b] = [points[0], points[1]];
    if (a == null || b == null) return weights;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const t =
      length < 1e-12 ? 0 : clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (length * length), 0, 1);
    weights[0] = 1 - t;
    weights[1] = t;
    return weights;
  }

  const triangles = triangulate(points);
  for (const [i, j, k] of triangles) {
    const a = points[i];
    const b = points[j];
    const c = points[k];
    if (a == null || b == null || c == null) continue;
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-12) continue;
    const w1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
    const w2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
    const w3 = 1 - w1 - w2;
    // The epsilon admits points on a shared edge, where two triangles both claim the
    // point. The first one wins, and the weights are continuous across the edge.
    if (w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9) {
      weights[i] = Math.max(0, w1);
      weights[j] = Math.max(0, w2);
      weights[k] = Math.max(0, w3);
      return weights;
    }
  }

  // Outside the convex hull: the nearest child, clamped, exactly like a 1D blend's ends.
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.hypot(point[0] - x, point[1] - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  weights[best] = 1;
  return weights;
}

/**
 * Grid blend weights: bilinear over the four surrounding children.
 *
 * Children are matched to grid cells by rounding their position by `gridSpacing`, so a
 * grid blend space needs no triangulation and no hull test.
 */
export function weightsGrid(
  points: [number, number][],
  x: number,
  y: number,
  spacing: number | undefined,
): number[] {
  const weights = new Array<number>(points.length).fill(0);
  const step = spacing != null && spacing > 0 ? spacing : 1;
  const cell = new Map<string, number>();
  points.forEach(([px, py], index) => {
    cell.set(`${Math.round(px / step)}:${Math.round(py / step)}`, index);
  });

  const gx = Math.round(x / step);
  const gy = Math.round(y / step);
  const fx = x / step - gx;
  const fy = y / step - gy;

  const corners: [number, number][] = [
    [gx, gy],
    [gx + 1, gy],
    [gx, gy + 1],
    [gx + 1, gy + 1],
  ];
  const weightsFor = [1, 0, 0, 0];
  weightsFor[0] = (1 - Math.abs(fx)) * (1 - Math.abs(fy));
  weightsFor[1] = Math.abs(fx) * (1 - Math.abs(fy));
  weightsFor[2] = (1 - Math.abs(fx)) * Math.abs(fy);
  weightsFor[3] = Math.abs(fx) * Math.abs(fy);

  let total = 0;
  corners.forEach(([cx, cy], cornerIndex) => {
    // A corner cell that does not exist shifts the weight onto the nearest present
    // corner, so a partial grid degrades to the children it has.
    const key = `${cx}:${cy}`;
    const index = cell.get(key) ?? nearestCell(cell, cx, cy);
    if (index == null) return;
    weights[index] = (weights[index] ?? 0) + (weightsFor[cornerIndex] ?? 0);
    total += weightsFor[cornerIndex] ?? 0;
  });

  if (total <= 0) {
    weights[0] = 1;
    return weights;
  }
  return weights.map((weight) => weight / total);
}

function nearestCell(cell: Map<string, number>, gx: number, gy: number): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [key, index] of cell) {
    const separator = key.indexOf(":");
    const cx = Number(key.slice(0, separator));
    const cy = Number(key.slice(separator + 1));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    const distance = Math.hypot(cx - gx, cy - gy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * Bowyer-Watson Delaunay triangulation, cached by point-set identity.
 *
 * O(n²) worst case on a handful of blend children, which is a load-time cost paid once.
 * Collinear inputs produce no triangles, and `weightsBarycentric` falls through to the
 * nearest-child branch — the validator rejects a collinear triangulated blend space at
 * load, so this is the runtime's own guard, not the only one.
 */
export function triangulate(points: [number, number][]): [number, number, number][] {
  const n = points.length;
  if (n < 3) return [];

  // A super-triangle large enough to contain every point, so the edge-cavity test has
  // one case instead of a boundary case.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const dx = (maxX - minX) * 20 || 20;
  const dy = (maxY - minY) * 20 || 20;
  const midpointX = (minX + maxX) / 2;
  const midpointY = (minY + maxY) / 2;

  const augmented: [number, number][] = [
    ...points,
    [midpointX - dx, midpointY - dy],
    [midpointX + dx, midpointY - dy],
    [midpointX, midpointY + dy],
  ];
  const superIndices: [number, number, number] = [n, n + 1, n + 2];
  let triangles: [number, number, number][] = [superIndices];

  for (let index = 0; index < n; index += 1) {
    const point = points[index];
    if (point == null) continue;

    const edges: [number, number][] = [];
    const kept: [number, number, number][] = [];
    for (const triangle of triangles) {
      const [a, b, c] = triangle;
      const pa = augmented[a];
      const pb = augmented[b];
      const pc = augmented[c];
      if (pa == null || pb == null || pc == null) continue;
      if (inCircumcircle(pa, pb, pc, point)) {
        edges.push([a, b], [b, c], [c, a]);
      } else {
        kept.push(triangle);
      }
    }

    // A shared edge appears twice, once per adjacent triangle. Keeping only the
    // unshared edges is what makes the cavity a boundary.
    const boundary = edges.filter(
      (edge) => !edges.some((other) => other[0] === edge[1] && other[1] === edge[0]),
    );

    triangles = kept;
    for (const [a, b] of boundary) {
      triangles.push([a, b, index]);
    }
  }

  return triangles.filter(([a, b, c]) => a < n && b < n && c < n);
}

function inCircumcircle(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  p: [number, number],
): boolean {
  // Translate p to the origin, so the incircle determinant collapses to a 3x3.
  const ax = a[0] - p[0];
  const ay = a[1] - p[1];
  const bx = b[0] - p[0];
  const by = b[1] - p[1];
  const cx = c[0] - p[0];
  const cy = c[1] - p[1];
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;

  const determinant =
    ax * (by * c2 - b2 * cy) - ay * (bx * c2 - b2 * cx) + a2 * (bx * cy - by * cx);

  // The orientation test keeps the sign meaningful for clockwise input triangles.
  const oriented = orient(a, b, c);
  return oriented > 0 ? determinant > 0 : determinant < 0;
}

function orient(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/* ── Direct states (§9) ──────────────────────────────────────────────── */

function sampleDirect(state: DirectState, ctx: SampleContext): StateSample {
  const sample = emptySample();
  sample.progress = 0;
  sample.speed = 1;

  for (const entry of state.entries) {
    const input = ctx.inputs.numbers.get(entry.input);
    if (input == null) continue;
    const [inMin, inMax] = entry.range;
    const span = inMax - inMin;
    const normalized = span === 0 ? 0 : (input.smoothed - inMin) / span;
    const value = normalized - (entry.zero != null ? (entry.zero - inMin) / span : 0);

    if ("bone" in entry.target) {
      const channel = entry.target.channel;
      const component = channel.slice(-1);
      const existing = sample.bones.get(entry.target.bone) ?? {};
      if (channel.startsWith("position")) {
        const vector: [number, number, number] =
          component === "x" ? [value, 0, 0] : component === "y" ? [0, value, 0] : [0, 0, value];
        existing.position = vector;
      } else {
        // A scale entry is a delta around 1: a direct state driving `scale.x` from a
        // slider at 0 must leave the bone at its authored size, not at zero.
        const base = existing.scale ?? [1, 1, 1];
        existing.scale =
          component === "x"
            ? [base[0] + value, base[1], base[2]]
            : component === "y"
              ? [base[0], base[1] + value, base[2]]
              : [base[0], base[1], base[2] + value];
      }
      sample.bones.set(entry.target.bone, existing);
    } else {
      const key = `${entry.target.morph.mesh}:${entry.target.morph.target}`;
      sample.morphs.set(key, clamp(value, ctx.morphRange[0], ctx.morphRange[1]));
    }
  }

  return sample;
}

/**
 * The additive delta of a state's sample against its `additiveRef` sample (§9.1).
 *
 * `sample ∘ ref⁻¹` per bone, `sample − ref` per morph. The reference is sampled at the
 * **same time as the state**, not at its own cursor: an additive layer measures the
 * delta from the pose at the same moment, and a reference sampled at a different time is
 * a delta of two poses plus a time offset, which is not a delta at all.
 */
export function toAdditiveDelta(
  sample: StateSample,
  reference: StateSample,
  morphRange: [number, number],
): {
  bones: Map<string, ReturnType<typeof additiveDelta>>;
  morphs: Map<string, number>;
} {
  const bones = new Map<string, ReturnType<typeof additiveDelta>>();
  for (const [bone, transform] of sample.bones) {
    bones.set(bone, additiveDelta(transform, reference.bones.get(bone) ?? {}));
  }
  const morphs = new Map<string, number>();
  for (const [key, weight] of sample.morphs) {
    morphs.set(key, clamp(weight - (reference.morphs.get(key) ?? 0), morphRange[0], morphRange[1]));
  }
  return { bones, morphs };
}

export type { StateSample, Cursor, MachineDefinition, BlendChild };
