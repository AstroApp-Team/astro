/**
 * Reading a Theatre.js number track, in core.
 *
 * The machine never touches Theatre, but the *shape* of a Theatre keyframe is data, not an
 * engine — so the sampler lives here, where it is pure, testable in the node project, and
 * usable by both the infrastructure resolver and the Studio's bake preview. The one thing
 * this module does not know is where a track came from.
 *
 * ── Why not linear ─────────────────────────────────────────────────────────
 *
 * A Theatre number track is a chain of cubic bézier segments. Sampling it linearly at the
 * key times is close enough on a slow ramp and visibly wrong on anything with an ease: a
 * bounce reads as a wobble with the accents in the wrong place, and an overshoot spring
 * silently loses its overshoot. Since the whole point of reusing Theatre timelines is that
 * the animation you rigged is the animation you get, the segment has to be evaluated as the
 * curve it is.
 *
 * ── The handle convention ──────────────────────────────────────────────────
 *
 * `handles` is `[x1, y1, x2, y2]`, each normalised to the segment's box: x over the
 * segment's *duration*, y over its *value delta*. So the segment is
 *
 *     x(s) = 3(1-s)²s·x1 + 3(1-s)s²·x2 + s³
 *     y(s) = 3(1-s)²s·y1 + 3(1-s)s²·y2 + s³
 *     value = a.value + (b.value - a.value) · y(s),   where x(s) = (t - a.position) / span
 *
 * and the job is to invert `x`. `[1/3, 1/3, 2/3, 2/3]` — Theatre's default — is the identity,
 * so a track with no handles samples exactly linearly.
 */

/** One keyframe of a Theatre number track, as much of it as sampling needs. */
export interface TheatreKeyframe {
  value: number;
  /** Seconds. Strictly increasing within a track. */
  position: number;
  /** `[x1, y1, x2, y2]`, normalised to the segment. Missing means linear. */
  handles?: readonly number[];
  /** `"hold"` freezes `value` until the next keyframe. */
  type?: string;
  connectedRight?: boolean;
}

/** Cubic bézier easing curve evaluated at `s`, in the unit box. */
export function bezierEase(s: number, x1: number, y1: number, x2: number, y2: number): number {
  const clamped = s <= 0 ? 0 : s >= 1 ? 1 : s;

  /* x(s) with p0 = 0, p1 = x1, p2 = x2, p3 = 1. */
  const x = (u: number): number => {
    const v = 1 - u;
    return 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
  };
  const y = (u: number): number => {
    const v = 1 - u;
    return 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u;
  };

  /* Newton first: x is monotonic for Theatre's handles, and three steps is a 1e-9 error. */
  let u = clamped;
  for (let i = 0; i < 4; i += 1) {
    const dx = x(u) - clamped;
    if (Math.abs(dx) < 1e-7) return y(u);
    const v = 1 - u;
    const slope = 3 * v * v * x1 + 6 * v * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(slope) < 1e-6) break;
    u -= dx / slope;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
  }

  /* Bisection finishes a pathological curve (slope near zero, or handles outside the box). */
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    u = (lo + hi) / 2;
    if (x(u) < clamped) lo = u;
    else hi = u;
  }
  return y((lo + hi) / 2);
}

/**
 * One scalar track at `t`, clamped at both ends.
 *
 * Outside the keyframe range the value is held, which is what Theatre does with a playhead
 * past the last key — a state whose clip runs longer than its tracks settles rather than
 * snapping back to zero.
 */
export function sampleNumberTrack(keyframes: readonly TheatreKeyframe[], t: number): number {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first == null || last == null) return 0;
  if (t <= first.position) return first.value;
  if (t >= last.position) return last.value;

  for (let i = 1; i < keyframes.length; i += 1) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (a == null || b == null || t > b.position) continue;

    const span = b.position - a.position;
    if (span <= 0) return b.value;
    if (a.type === "hold") return a.value;

    const delta = b.value - a.value;
    /* A flat segment is flat at every handle setting — skip the solve, and skip its noise. */
    if (delta === 0) return a.value;

    const handles = a.handles;
    const x1 = handles?.[0] ?? 1 / 3;
    const y1 = handles?.[1] ?? 1 / 3;
    const x2 = handles?.[2] ?? 2 / 3;
    const y2 = handles?.[3] ?? 2 / 3;
    const eased = bezierEase((t - a.position) / span, x1, y1, x2, y2);
    return a.value + delta * eased;
  }
  return last.value;
}

/** Sorted union of every track's key times, so a vec3 samples on one shared grid. */
export function unionKeyTimes(tracks: readonly (readonly TheatreKeyframe[])[]): number[] {
  const times = new Set<number>();
  for (const track of tracks) for (const key of track) times.add(key.position);
  return [...times].sort((a, b) => a - b);
}

/**
 * XYZ Euler (radians) → unit quaternion `[x, y, z, w]`.
 *
 * Theatre stores a rotation as three Euler tracks; the machine consumes one quaternion, so
 * the axes are resampled on the union of their key times and converted per sample. Reading
 * each axis as its own channel would let the three drift apart and produce a non-normalised
 * rotation that nothing downstream could diagnose.
 */
export function quatFromEuler(x: number, y: number, z: number): [number, number, number, number] {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  const q: [number, number, number, number] = [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}
