/**
 * The internal shapes the state machine modules pass each other.
 *
 * These are **not** the public schema. The public schema is JSON the Studio writes; these
 * are the mutable working set one frame runs over, and they never escape `core/`. They
 * live here so eleven modules do not each redeclare a layer accumulator and drift.
 *
 * Two rules the rest of the directory depends on:
 *
 * - The frame snapshot is **frozen** at the top of a frame. Anything a callback writes
 *   lands in the next frame's snapshot, which is what makes "order independence within a
 *   frame" a property of the data rather than of call order.
 * - The pose accumulator is **sparse and reused**. A frame writes into existing maps;
 *   it does not allocate them. The public `MachineOutput` is a read-only view over it.
 */

import type {
  BoneTransform,
  Condition,
  Easing,
  InputDef,
  InterruptionPolicy,
  LayerDef,
  MachineDefinition,
  MachineEvents,
  MachineOptions,
  MarkerDef,
  PlayStyle,
  PointerHit,
  PointerState,
  Quat,
  StateDef,
  TransitionDef,
  Vec3,
} from "@core/models/animationStateMachine.ts";

/* ── Inputs ──────────────────────────────────────────────────────────── */

export interface NumberInputState {
  name: string;
  /** The raw target. `getNumber` returns this. */
  value: number;
  /** What conditions and blend weights read. */
  smoothed: number;
  /** Critically-damped smoothing state: the velocity carried between frames. */
  velocity: number;
  min: number;
  max: number;
  smoothTime: number;
}

export interface BooleanInputState {
  name: string;
  value: boolean;
}

export interface TriggerInputState {
  name: string;
  /** Seconds of unconsumed life remaining. `Infinity` = until consumed. */
  remainingTtl: number;
  pending: boolean;
  ttl: number;
  shared: boolean;
}

/** Everything a condition, a blend weight or a constraint may read this frame. */
export interface InputSnapshot {
  numbers: ReadonlyMap<string, NumberInputState>;
  booleans: ReadonlyMap<string, BooleanInputState>;
  triggers: ReadonlyMap<string, TriggerInputState>;
  /** Values a constraint published with `exposeAs`, readable from the next frame. */
  derived: ReadonlyMap<string, number>;
}

/* ── Frame ───────────────────────────────────────────────────────────── */

export interface FrameSnapshot {
  inputs: InputSnapshot;
  /** Pointer snapshots keyed by `pointerId`. Absent means "no hit". */
  pointers: ReadonlyMap<number, PointerState>;
  dt: number;
  elapsed: number;
  /** Injected, never `Math.random`. The caller owns the seed. */
  rng: () => number;
}

/* ── Pose ────────────────────────────────────────────────────────────── */

/**
 * A sparse pose. Only bones a layer or constraint touched are present, which is what
 * `MachineOutput.bones` publishes and what the adapter writes to three.js.
 */
export interface PoseAccumulator {
  bones: Map<string, BoneTransform>;
  /** Key is `${mesh}:${target}`. */
  morphs: Map<string, number>;
  bonesDirty: boolean;
  morphsDirty: boolean;
}

/* ── Cursors ─────────────────────────────────────────────────────────── */

/**
 * One running instance of a timeline. Each state that references a timeline owns its
 * own cursor, so the same walk cycle on two layers never shares time.
 */
export interface Cursor {
  timelineId: string;
  /** Seconds. Normalised time is derived at the edges, never stored. */
  time: number;
  direction: 1 | -1;
  /** Completed loops for `loop`, completed round trips for `pingPong`. */
  loops: number;
  /** Set when a `pingPong` has used up its `count`, or a `once` reached its end. */
  finished: boolean;
  /** Resolved from the timeline, so a cursor can be advanced without a lookup. */
  style: PlayStyle;
  /** The authority for normalised time, copied so a cursor is self-describing. */
  duration: number;
}

/* ── Transitions ─────────────────────────────────────────────────────── */

export interface TransitionRecord {
  from: string;
  to: string;
  elapsed: number;
  duration: number;
  /** `frozen` = the from side stopped advancing when the fade started (§8.2). */
  source: "live" | "frozen";
  policy: InterruptionPolicy;
  /** The from state's sample, captured when a fade starts from a blended pose. */
  frozenFrom: PoseAccumulator | null;
  /** Where the `to` state's cursor started. Set by `syncTime` or the state's `startAt`. */
  startToTime: number | null;
  /** The fade's easing. `undefined` is the default curve, not "linear". */
  easing: Easing | undefined;
  /**
   * The outgoing state's own cursor.
   *
   * It lives on the record, not on the layer: while a fade runs the layer's `cursor`
   * belongs to the incoming state, and the outgoing side needs its own time so a
   * `pingPong` mid-reverse does not snap forward when the cut starts. `null` means the
   * outgoing pose was frozen at the cut (`frozenFrom` holds it) and there is nothing to
   * advance.
   */
  fromCursor: Cursor | null;
  /** The incoming state's duration, resolved at cut time; `syncTime` and markers use it. */
  toDuration: number;
}

/* ── Layers ──────────────────────────────────────────────────────────── */

export interface LayerRuntime {
  layerId: string;
  /** The state this layer is playing. `null` before its Entry resolves. */
  activeStateId: string | null;
  cursor: Cursor | null;
  /** Blend-space children keep their own cursors, keyed `stateId:index` (see `childCursorKey`). */
  childCursors: Map<string, Cursor>;
  transition: TransitionRecord | null;
  /** Last-frame result of each hysteresis comparison, keyed by condition site. */
  hysteresis: Map<string, boolean>;
  /** Triggers this layer consumed, so a non-shared trigger is invisible to the rest. */
  consumedTriggers: Set<string>;
  /** `setLayerEnabled(false)` — the layer contributes nothing and resolves nothing. */
  enabled: boolean;
  /** `setLayerWeight` override, cleared by `reset`. */
  weightOverride: number | null;
  /** True once the Entry transition has run. */
  started: boolean;
  /** True once the layer reached its Exit state. */
  complete: boolean;
  /** The pose a fade started from, for an `interrupt` restart from the blended pose. */
  frozenFromPose: PoseAccumulator | null;
  /** The queued transition, for the `queue` policy (max depth 1, last-wins). */
  queued: { transition: TransitionDef; forced: boolean } | null;
  /** Triggers consumed by the transition currently in flight, for §4.3 accounting. */
  inFlightTriggers: Set<string>;
  /** Loop-local progress of the active state, for `exitTime`. */
  progress: number;
  /** The active state's resolved speed, for `getActiveState`. */
  speed: number;
}

/* ── Events ──────────────────────────────────────────────────────────── */

export type PendingEvent = {
  [K in keyof MachineEvents]: { name: K; payload: MachineEvents[K] };
}[keyof MachineEvents];

/* ── Machine runtime ─────────────────────────────────────────────────── */

export interface MachineRuntime {
  definition: MachineDefinition;
  options: Required<
    Pick<
      MachineOptions,
      "rotationBlend" | "maxChainDepth" | "epsilon" | "defaultInterruption" | "maxDt"
    >
  > & {
    morphRange: [number, number];
    defaultTriggerTtl: number;
  };
  inputs: {
    numbers: Map<string, NumberInputState>;
    booleans: Map<string, BooleanInputState>;
    triggers: Map<string, TriggerInputState>;
    derived: Map<string, number>;
  };
  /** Declared input metadata, for `machine.inputs` and for loud unknown-name errors. */
  inputDefs: Map<string, InputDef>;
  layers: LayerRuntime[];
  /** Pointer hits forwarded by the host, consumed by the next frame's ingestion. */
  pendingPointers: PointerHit[];
  pointers: Map<number, PointerState>;
  /** Listener actions queued by `pointer()`, applied at the start of the next frame. */
  pendingActions: { layer: string; action: string }[];
  /** Listener drag capture: pointerId → the mesh that owns the drag. */
  dragOwner: Map<number, string>;
  /** Pointer state per pointerId for listener bookkeeping (hover, click timing). */
  hover: Map<string, number>;
  lastClick: { mesh: string; at: number; button: number } | null;
  listenersEnabled: boolean;
  elapsed: number;
  rng: () => number;
  /** Actions a listener queued. Applied in step 1 of the next frame. */
  queuedListenerActions: ListenerActionRecord[];
  /** Values a constraint published, carried into the next frame's snapshot. */
  nextDerived: Map<string, number>;
  /** Last-good value per constraint id, for a `breakOnCycle: false` cycle. */
  constraintLastGood: Map<string, number>;
}

/** A listener action plus the frame it was queued in, so `setFromDrag` reads one drag. */
export interface ListenerActionRecord {
  listenerId: string;
  action: ListenerActionUnion;
}

/** Mirrors `ListenerAction` without importing it twice, keeping this file the hub. */
export type ListenerActionUnion =
  | { set: string; to: number | boolean }
  | { fire: string }
  | { toggle: string }
  | { add: string; amount: number }
  | {
      setFromDrag: string;
      axis: "x" | "y" | "u" | "v" | "distance";
      map: [number, number, number, number];
    };

/* ── Sampling ────────────────────────────────────────────────────────── */

/** One state's contribution at one time. Sparse on both channels. */
export interface StateSample {
  bones: Map<string, BoneTransform>;
  morphs: Map<string, number>;
  markers: MarkerDef[];
  /** Loop-local progress of the sampled state, for `exitTime`. */
  progress: number;
  /** The resolved speed, for `getActiveState`. */
  speed: number;
}

/** The delta form an additive layer needs: sample ∘ ref⁻¹ per bone, sample − ref per morph. */
export interface AdditiveDelta {
  bones: Map<string, BoneTransform>;
  morphs: Map<string, number>;
}

/* ── Conditions ──────────────────────────────────────────────────────── */

/** A condition site, stable across frames, so hysteresis can key on it. */
export interface ConditionSite {
  layerId: string;
  transitionKey: string;
  path: string;
}

export type {
  Condition,
  Easing,
  InputDef,
  InterruptionPolicy,
  LayerDef,
  MachineDefinition,
  MarkerDef,
  PointerHit,
  PointerState,
  Quat,
  StateDef,
  TransitionDef,
  Vec3,
};
