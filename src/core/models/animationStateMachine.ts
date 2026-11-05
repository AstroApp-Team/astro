/**
 * The animation state machine's public contract (§3.1).
 *
 * This file is the **only** outward-facing type in the feature. It is JSON-shaped on
 * purpose: the Studio writes it, a file on disk holds it, `createMachine` reads it, and
 * the runtime's internal shapes never appear here. If a type is not serialisable, it
 * does not belong in this file.
 *
 * Two rules the rest of the feature depends on:
 *
 * - **Normalized time is the unit.** Every authored time is 0..1 of a clip's duration.
 *   Seconds exist only inside `timeline.duration` and `fade.duration`, and the cursor
 *   converts between the two.
 * - **`schemaVersion` is a number, not a string.** A migration is a function from one
 *   integer to the next; a semver string invites comparison logic nobody writes.
 */

/* ── Primitives ──────────────────────────────────────────────────────── */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/**
 * A bone pose. Every channel is optional: a layer that animates only `position.x`
 * writes only `position.x`, and the accumulator keeps it sparse. A blend that needs a
 * missing channel treats it as the identity, not as zero — a missing rotation is "no
 * rotation", a missing position is "the bind position".
 */
export interface BoneTransform {
  position?: Vec3;
  rotationQuat?: Quat;
  scale?: Vec3;
}

export interface MorphWeights {
  mesh: string;
  weights: Record<string, number>;
}

/* ── Inputs (§4) ─────────────────────────────────────────────────────── */

export interface NumberInputDef {
  kind: "number";
  name: string;
  default: number;
  min?: number;
  max?: number;
  /**
   * Seconds to reach a target with critically-damped smoothing (§4.2). `0` is a hard
   * set. The default is 0 because a definition that wants smoothing says so.
   */
  smoothTime?: number;
}

export interface BooleanInputDef {
  kind: "boolean";
  name: string;
  default: boolean;
}

export interface TriggerInputDef {
  kind: "trigger";
  name: string;
  /**
   * Seconds of unconsumed life. `Infinity` = "until consumed". The machine's
   * `defaultTriggerTtl` fills in when this is absent.
   */
  ttl?: number;
  /**
   * Consumed by the first layer that sees it (§4.3). `shared: true` makes it visible
   * to every layer, which is the only way a trigger can drive two layers at once.
   */
  shared?: boolean;
}

export type InputDef = NumberInputDef | BooleanInputDef | TriggerInputDef;

/* ── Conditions (§4.4) ───────────────────────────────────────────────── */

export type NumberOp =
  | "greaterThan"
  | "lessThan"
  | "greaterOrEqual"
  | "lessOrEqual"
  | "equals"
  | "notEquals";
export type BooleanOp = "equals" | "notEquals";
export type TriggerOp = "fired";

export interface NumberCondition {
  input: string;
  op: NumberOp;
  value: number;
  /**
   * Seconds of **unmet** time required before the condition reads false again. The
   * comparison flips true at the threshold and false at `value ± hysteresis`.
   */
  hysteresis?: number;
}

export interface BooleanCondition {
  input: string;
  op: BooleanOp;
  value: boolean;
}

export interface TriggerCondition {
  input: string;
  op: TriggerOp;
  /** Consume on read. Default true; set false to let several transitions see one fire. */
  consume?: boolean;
}

export type LeafCondition = NumberCondition | BooleanCondition | TriggerCondition;

export interface AllCondition {
  all: Condition[];
}

export interface AnyCondition {
  any: Condition[];
}

export interface NotCondition {
  not: Condition;
}

/**
 * A condition tree. Leaves are `{ input, op, value }`; `all` / `any` / `not` nest.
 * `all` and `any` are evaluated **short-circuit left to right**, which matters because
 * a trigger leaf consumes on read: the leaf after a true `all` branch never runs.
 */
export type Condition = LeafCondition | AllCondition | AnyCondition | NotCondition;

/* ── Masks (§7) ──────────────────────────────────────────────────────── */

export interface MaskDef {
  /** Bones by name. A bone name is also a group name; groups expand at resolution. */
  bones?: string[];
  morphs?: { mesh: string; target: string }[];
  /** Mask names, resolved recursively. */
  extends?: string[];
  /** Mask names removed from the union. */
  subtract?: string[];
  /**
   * Per-channel overrides. The key is `bone.channel` (e.g. `"spine.rotationQuat"`) or
   * `mesh:target` for a morph. A weight of 0 removes the channel; a weight of 0.5
   * blends it with the layer below.
   */
  channels?: Record<string, number>;
}

/* ── Transitions (§8) ────────────────────────────────────────────────── */

export type Easing =
  | { kind: "linear" }
  | { kind: "easeIn" }
  | { kind: "easeOut" }
  | { kind: "easeInOut" }
  | { kind: "cubicBezier"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "smoothstep" };

export interface FadeSpec {
  /**
   * `fixed` — `duration` is seconds. `normalized` — `duration` is a fraction of the
   * **from** state's clip duration, resolved at transition start.
   */
  mode: "fixed" | "normalized";
  duration: number;
  easing?: Easing;
}

/**
 * What a cut does to a fade already in flight (§8.2).
 *
 * - `ignore` — the cut is dropped.
 * - `interrupt` — the fade restarts from the **current blended pose**.
 * - `interruptKeepPlaying` — the outgoing side keeps advancing while the new fade runs.
 * - `queue` — the cut waits for the fade to finish. Queue depth is 1, last-wins.
 */
export type InterruptionPolicy = "ignore" | "interrupt" | "interruptKeepPlaying" | "queue";

export interface TransitionDef {
  from: string;
  to: string;
  when?: Condition;
  /**
   * Normalized progress of the **from** state at which the cut becomes eligible.
   * Rejected at load on a direct state, which has no time axis.
   */
  exitTime?: number;
  /** Seconds. `0` cuts instantly. */
  duration?: number;
  easing?: Easing;
  /** Shorthand for `{ mode: "fixed", duration, easing }`. */
  fade?: FadeSpec;
  /**
   * Re-anchor the **to** state's cursor to the from state's normalized time at
   * transition start. The conversion is normalized, never raw seconds.
   */
  syncTime?: boolean;
  /** Consume every trigger the transition read. Default true. */
  consumeTriggers?: boolean;
  /** See `StateBase.tags`. */
  tags?: string[];
  interruption?: InterruptionPolicy;
}

/* ── Timelines (§5) ──────────────────────────────────────────────────── */

export type PlayStyle =
  | { kind: "once"; onEnd?: "stop" | "loop" | "hold" }
  | { kind: "loop" }
  /** `count` is round trips. Omit for endless ping-pong. */
  | { kind: "pingPong"; count?: number }
  | { kind: "clampForever" };

/**
 * A speed is a constant, or a live input scaled and offset. The input form is what
 * lets a walk cycle speed up with a `locomotion` value without a state per speed.
 */
export type SpeedBinding = number | { input: string; scale?: number; offset?: number };

export interface MarkerDef {
  name: string;
  /** Normalized 0..1. The cursor converts with `duration`. */
  time: number;
  payload?: string;
}

export interface TimelineEventDef {
  name: string;
  /** **Seconds**, not normalized: events fire on the timeline's own clock. */
  time: number;
  payload?: string;
}

export interface TimelineDef {
  id: string;
  /**
   * The authority for normalised time. Every state referencing this timeline converts
   * with this number, which is what makes a shared timeline mean a shared phase.
   */
  duration: number;
  playStyle: PlayStyle;
  speed: SpeedBinding;
  /** Curve applied to normalized position (§5.4). */
  speedCurve?: Easing;
  /**
   * Phase-lock group. Members advance on the same clock and are validated to agree on
   * duration; a member that disagrees cannot stay in step.
   */
  syncGroup?: string;
  /** Normalized 0..1, or `"random"` — drawn from the injected RNG, never `Math.random`. */
  startAt?: number | "random";
  markers?: MarkerDef[];
  events?: TimelineEventDef[];
  /**
   * The sheet properties this timeline owns, e.g. `["Astro.position.x", "Astro.expression"]`.
   *
   * A machine timeline is a *sequence*, not a cursor: the dope sheet shows these rows and nothing
   * else, so two timelines can animate two different sets of props over two different windows of
   * the same sheet. Empty means "all of the sheet's tracks", which is the old behaviour.
   */
  props?: string[];
  /**
   * The sheet window this timeline plays, in seconds. `offset + length` must stay inside the sheet
   * sequence; `length` defaults to `duration` and `offset` to 0.
   */
  length?: number;
  offset?: number;
  /** Inline clip reference. A state referencing this timeline may override the asset. */
  clip?: string;
  morphCurve?: string;
}

/* ── States (§9) ─────────────────────────────────────────────────────── */

export interface ScrubBinding {
  input: string;
  /** Input range mapped onto the clip. */
  range: [number, number];
}

interface StateBase {
  id: string;
  /** Normalized 0..1, or `"random"`. */
  startAt?: number | "random";
  speed?: SpeedBinding;
  /** Multiplies `speed`. Kept separate: authored speed and authored scale drift apart. */
  timeScale?: number;
  /** Normalized 0..1. */
  speedCurve?: Easing;
  /** Seconds. `0` is instant. */
  exitFade?: number;
  /** Normalized 0..1. */
  exitEasing?: Easing;
  /** Seconds to blend this state's pose in on entry. */
  entryFade?: number;
  additiveRef?: string;
  mask?: string | MaskDef;
  markers?: MarkerDef[];
  /**
   * Free-form labels, matched by `Machine.hasTag`. Purely an annotation: nothing in the
   * runtime branches on a tag, so a tag is safe to add, rename or leave unused.
   */
  tags?: string[];
}

export interface ClipState extends StateBase {
  type: "clip";
  clip?: string;
  morphCurve?: string;
  /**
   * A timeline id (§5). The state owns a cursor over it; the timeline owns duration,
   * play style, speed and markers. `clip` and `morphCurve` here are the inline form of
   * the same thing, for a one-off reference no other state shares.
   */
  timeline?: string;
  /** Direct time control. Requires a clip; rejected at load without one. */
  scrub?: ScrubBinding;
}

export interface BlendChild {
  clip?: string;
  morphCurve?: string;
  timeline?: string;
  position: number | [number, number];
  speed?: number;
  timeScale?: number;
}

export interface Blend1dState extends StateBase {
  type: "blend1d";
  input: string;
  children: BlendChild[];
}

export interface Blend2dState extends StateBase {
  type: "blend2d";
  inputX: string;
  inputY: string;
  children: BlendChild[];
  /** `barycentric` is the default: it is what "triangulated" means. */
  algorithm?: "grid" | "triangulated";
  /** Grid step for `algorithm: "grid"`. */
  gridSpacing?: number;
}

export interface DirectEntry {
  input: string;
  target:
    | {
        bone: string;
        channel: "position.x" | "position.y" | "position.z" | "scale.x" | "scale.y" | "scale.z";
      }
    | { morph: { mesh: string; target: string } };
  /** Input range mapped onto the channel. */
  range: [number, number];
  /** Input value mapped to output 0. */
  zero?: number;
}

export interface DirectState extends StateBase {
  type: "direct";
  entries: DirectEntry[];
}

export interface ExitState extends StateBase {
  type: "exit";
}

export type StateDef = ClipState | Blend1dState | Blend2dState | DirectState | ExitState;

/* ── Layers (§9.1) ───────────────────────────────────────────────────── */

export interface LayerDef {
  id: string;
  /** Highest priority wins a conflict (§9.1). */
  priority: number;
  /**
   * `override` replaces the pose below it. `additive` applies `sample ∘ ref⁻¹` per
   * bone and `sample − ref` per morph, where `ref` is `additiveRef`.
   */
  blend: "override" | "additive";
  /** A number, or a number input scaled into [0, 1]. */
  weight: number | { input: string; scale?: number };
  mask?: string | MaskDef;
  states: StateDef[];
  transitions: TransitionDef[];
  /** Transitions from any state. Evaluated after state-local ones. */
  anyState: TransitionDef[];
  /** Evaluated in order; the first eligible one wins. The last must be unconditional. */
  entry: { to: string; when?: Condition; fade?: number; easing?: Easing }[];
  /** Default `additiveRef` for every state in the layer. */
  additiveRef?: string;
  /** See `StateBase.tags`. */
  tags?: string[];
}

/* ── Constraints (§6) ────────────────────────────────────────────────── */

export type Ref =
  | { bone: string; channel?: "position" | "rotation" | "scale" }
  | { input: string }
  | { pointer: PointerRef }
  | { world: "position" | "rotation" };

export type Measure = "distance" | "axisDelta" | "angle" | "heightAbovePlane";

export interface ProportionalKind {
  type: "proportional";
  source: Ref;
  reference: Ref;
  measure: Measure;
  factor: number;
  /** Only for `measure: "heightAbovePlane"`. */
  plane?: string;
  /** Axis for `measure: "axisDelta"`. */
  axis?: "x" | "y" | "z";
}

export interface AimKind {
  type: "aim";
  source: Ref;
  reference: Ref;
  up?: Vec3;
  /** Radians. */
  limit?: number;
}

export interface FollowKind {
  type: "follow";
  source: Ref;
  /** Seconds of lag. */
  damping: number;
}

export interface LimitKind {
  type: "limit";
  /** The channel being limited. */
  source: Ref;
  min?: number;
  max?: number;
}

export interface CopyKind {
  type: "copy";
  source: Ref;
}

export interface PointerRef {
  mesh?: string;
  surface?: string;
  pointerId?: number;
  /** `uv` is the surface UV; `world` is the hit point. */
  space?: "uv" | "world" | "screen";
}

export interface PointerKind {
  type: "pointer";
  pointer: PointerRef;
  /** The channel the pointer drives, e.g. `position.x`. */
  channel: string;
  /** Hit value mapped onto the channel. */
  map: [number, number, number, number];
}

export type ConstraintKind =
  | ProportionalKind
  | AimKind
  | FollowKind
  | LimitKind
  | CopyKind
  | PointerKind;

export interface ConstraintDef {
  id: string;
  target:
    | { bone: string; channel: "position" | "rotationQuat" | "scale" }
    | { morph: { mesh: string; target: string } }
    | { pose: string };
  kind: ConstraintKind;
  /** 0..1. */
  weight?: number;
  mask?: string | MaskDef;
  /** Publish the solved value as a number input, readable from the next frame. */
  exposeAs?: string;
  /** Default true: a cycle is a load error. False freezes the last-good value. */
  breakOnCycle?: boolean;
  enabled?: boolean;
}

/* ── Pointer listeners (§10) ─────────────────────────────────────────── */

export type PointerEventName =
  | "pointerEnter"
  | "pointerLeave"
  | "pointerDown"
  | "pointerUp"
  | "click"
  | "doubleClick"
  | "dragStart"
  | "drag"
  | "dragEnd";

export interface ListenerTarget {
  mesh: string;
  surface?: string;
}

export type ListenerAction =
  | { set: string; to: number | boolean }
  | { fire: string }
  | { toggle: string }
  | { add: string; amount: number }
  | {
      setFromDrag: string;
      axis: "x" | "y" | "u" | "v" | "distance";
      map: [number, number, number, number];
    };

export interface ListenerDef {
  target: ListenerTarget;
  event: PointerEventName;
  actions: ListenerAction[];
  /** Restrict the listener to one layer's hit region. */
  layer?: string;
}

/* ── Definition ──────────────────────────────────────────────────────── */

export interface MachineOptions {
  /** `slerp` is the default. `nlerp` is cheaper and visibly wrong past ~90°. */
  rotationBlend?: "slerp" | "nlerp";
  /** Default 8. Guards the Any State chain, not the layer count. */
  maxChainDepth?: number;
  /** Comparison epsilon. Default 1e-6. */
  epsilon?: number;
  /** Default interruption policy when a transition names none. */
  defaultInterruption?: InterruptionPolicy;
  /** Default 1/30. A frame longer than this is clamped, so a tab switch cannot teleport. */
  maxDt?: number;
  /** Morph weight range. Default [0, 1]. */
  morphRange?: [number, number];
  /** Trigger life when a trigger input names no `ttl`. Default Infinity. */
  defaultTriggerTtl?: number;
  /**
   * Optional. The bone whose translation is published as `output.rootMotion`.
   *
   * With no root bone the machine reports zero motion, which is the right answer for a
   * rig that animates the model root itself. With one, the host is expected to add the
   * delta to the model root and the clips must *not* key that same transform — one owner
   * per property, the same rule the Theatre scenes follow.
   */
  rootBone?: string;
}

export interface MachineDefinition {
  schemaVersion: number;
  name: string;
  /**
   * The scene its clips resolve against. Not read by the runtime — theatre tracks are
   * already baked into the timelines — but the editor groups machines by it, and it is
   * what turns "this machine belongs to another scene" from a silent empty pose into a
   * validation error.
   */
  scene?: string;
  /** See `StateBase.tags`. Machine-level tags are matched by `hasTag` too. */
  tags?: string[];
  inputs: InputDef[];
  layers: LayerDef[];
  /** Optional. A machine with no constraints is a plain state machine. */
  constraints?: ConstraintDef[];
  /** Optional. A machine with no listeners is not interactive. */
  listeners?: ListenerDef[];
  masks?: Record<string, MaskDef>;
  groups?: {
    morph?: Record<string, { mesh: string; target: string }[]>;
    bones?: Record<string, string[]>;
  };
  timelines?: TimelineDef[];
  options?: MachineOptions;
}

/* ── Runtime surface ─────────────────────────────────────────────────── */

export interface PointerState {
  pointerId: number;
  // `| undefined` on every optional field: `exactOptionalPropertyTypes` is on, and both of
  // these shapes are built by copying fields out of a `PointerHit`, which is exactly the
  // case where an optional field is an explicit undefined.
  mesh?: string | undefined;
  surface?: string | undefined;
  /** Normalized 0..1 on the surface the hit landed on. */
  uv?: [number, number] | undefined;
  world?: Vec3 | undefined;
  screen?: [number, number] | undefined;
  down: boolean;
  drag: boolean;
}

/** A hit the host forwards. The machine never raycasts; the host owns the pointer. */
export interface PointerHit {
  pointerId: number;
  mesh?: string | undefined;
  surface?: string | undefined;
  uv?: [number, number] | undefined;
  world?: Vec3 | undefined;
  screen?: [number, number] | undefined;
  phase: "enter" | "move" | "down" | "up" | "leave";
  button?: number | undefined;
}

export interface MachineEvents {
  marker: { layer: string; state: string; name: string; payload?: string };
  timelineEvent: { timeline: string; name: string; payload?: string };
  transition: { layer: string; from: string; to: string };
  stateEnter: { layer: string; state: string };
  stateExit: { layer: string; state: string };
  /** A listener fired. `action` is the index of the action that ran. */
  listener: { listener: string; event: PointerEventName; action: number };
  /** A cut was dropped by the `ignore` policy, or by a full queue. */
  blocked: { layer: string; to: string; reason: "interruption" | "queue" };
  /** A constraint cycle was frozen because `breakOnCycle` was false. */
  cycle: { constraint: string; channel: string };
  /**
   * A fade reached its end and the incoming state owns the layer alone.
   *
   * Distinct from `stateEnter`, which fires when the cut *starts*: an editor wants to
   * know when the crossfade stopped mixing, and a listener that needs that from
   * `stateEnter` has to re-derive the fade's duration and hope nothing interrupted it.
   */
  transitionComplete: { layer: string; from: string; to: string };
}

export type MachineEventName = keyof MachineEvents;

export interface ActiveStateInfo {
  layer: string;
  state: string;
  /** Normalized 0..1. */
  progress: number;
  /** Seconds. */
  remaining: number;
  speed: number;
}

/**
 * The root bone's translation change for one frame.
 *
 * A delta, not an absolute: a clip that keys an in-place walk publishes the footfall
 * cycle and the host accumulates it, so the model's position is owned by the host and the
 * clip never has to know how far the character has travelled.
 */
export interface RootMotion {
  /** Metres (or rig units) since the previous `step`. Zero when no `rootBone` is set. */
  translation: Vec3;
}

export interface MachineOutput {
  bones: Record<string, BoneTransform>;
  morphs: MorphWeights[];
  rootMotion: RootMotion;
}

/** A fade currently in flight, as the editor's telemetry wants it. */
export interface ActiveTransitionInfo {
  layer: string;
  from: string;
  to: string;
  /** Seconds since the cut started. */
  elapsed: number;
  /** The fade's total length. `0` is an instant cut that has already finished. */
  duration: number;
  /** Normalized 0..1, eased nowhere — the editor draws the raw ramp. */
  normalized: number;
  /** `frozen` = the outgoing side stopped advancing when the fade started. */
  source: "live" | "frozen";
}

export interface Machine {
  readonly definition: MachineDefinition;

  setNumber(name: string, value: number): void;
  setBoolean(name: string, value: boolean): void;
  fire(name: string): void;
  getNumber(name: string): number;
  getBoolean(name: string): boolean;

  /** Pointer hits are forwarded, not raycast. The host owns the pointer. */
  pushPointer(hit: PointerHit): void;

  /**
   * Advance one frame. `dt` is clamped by `options.maxDt`; `elapsed` is the machine's
   * own clock, so a paused machine keeps its phase.
   */
  step(dt: number, elapsed: number): MachineOutput;

  on<K extends MachineEventName>(
    event: K,
    listener: (payload: MachineEvents[K]) => void,
  ): () => void;

  getActiveState(layer: string): ActiveStateInfo | null;

  /** The fade in flight on `layer`, or `null` when it owns the layer outright. */
  getActiveTransition(layer: string): ActiveTransitionInfo | null;

  /** True when `tag` is declared on the machine, a layer, a state or a transition. */
  hasTag(tag: string): boolean;

  /**
   * The smoothed value of a number input — what conditions and blend weights read.
   * `getNumber` returns the raw target, which is a different number for the same frame.
   */
  getSmoothedNumber(name: string): number;

  /** True while a trigger is pending: fired, alive, and not yet consumed. */
  isTriggerPending(name: string): boolean;

  /**
   * Subscribe for exactly one delivery. `filter` runs before the listener, so a `once`
   * on `transitionComplete` can wait for one specific `to` state without unsubscribing
   * inside its own callback (which would work, but reads as a leak to a reviewer).
   */
  once<K extends MachineEventName>(
    event: K,
    listener: (payload: MachineEvents[K]) => void,
    filter?: (payload: MachineEvents[K]) => boolean,
  ): () => void;

  /** The delta published by the most recent `step`. Zero before the first frame. */
  getRootMotion(): RootMotion;

  setLayerWeight(layer: string, weight: number): void;
  setLayerEnabled(layer: string, enabled: boolean): void;

  /** Force a cut, bypassing conditions. Honours the target's interruption policy. */
  forceTransition(layer: string, to: string): void;

  /** Normalized 0..1. Only meaningful on a state with a time axis. */
  seek(layer: string, normalizedTime: number): void;

  /** Restore declared defaults, clear triggers, clear pointer state. */
  reset(): void;

  dispose(): void;
}

/* ── Rig description (§11.1) ─────────────────────────────────────────── */

/**
 * What a rig tells the validator. With one, bone and morph names are checked at load;
 * without one, every name check is deferred to the adapter, which is the only place
 * that can know them.
 */
export interface RigDescription {
  bones: string[];
  meshes?: { mesh: string; targets: string[] }[];
  /** Named planes for `measure: "heightAbovePlane"`. */
  planes?: Record<string, { point: Vec3; normal: Vec3 }>;
  /** Named poses for `{ pose: string }` targets. */
  poses?: string[];
}

export const SCHEMA_VERSION = 1;
