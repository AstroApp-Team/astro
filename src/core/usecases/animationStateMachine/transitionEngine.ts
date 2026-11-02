/**
 * Transitions, entries and cursors (§5, §8).
 *
 * This module owns everything that *moves time forward*: advancing a state's cursor,
 * deciding when a cut is eligible, and carrying a fade from one state's pose to the
 * next. It does not touch the accumulator — the composer does that — so a transition can
 * be reasoned about, and tested, without a pose.
 *
 * The three shapes it works with:
 *
 * - **`Cursor`** — one state's time. Seconds, plus the style it is being played by;
 *   normalized time is derived at the edges (`timelineCursor.ts`).
 * - **`LayerRuntime`** — one layer's live state: which state is playing, its cursor, the
 *   fade in flight, and the hysteresis memory conditions key on.
 * - **`TransitionRecord`** — the fade in flight, including the outgoing cursor. The
 *   outgoing side keeps advancing while a fade runs unless the record says otherwise,
 *   which is the difference between `interrupt` and `interruptKeepPlaying` (§8.2).
 */

import type { AssetResolver } from "@core/interfaces/animationAssets.ts";
import type {
  Easing,
  InterruptionPolicy,
  LayerDef,
  MachineDefinition,
  MachineEvents,
  MarkerDef,
  StateDef,
  TimelineDef,
  TransitionDef,
} from "@core/models/animationStateMachine.ts";
import { evalCondition, resolveSpeed } from "@core/usecases/animationStateMachine/conditionEval.ts";
import { applyCurve, easingFn } from "@core/usecases/animationStateMachine/easing.ts";
import {
  blendPoses,
  clonePose,
  emptyPose,
} from "@core/usecases/animationStateMachine/blendPoses.ts";
import { clamp } from "@core/usecases/animationStateMachine/mathUtil.ts";
import { OPEN_MASK } from "@core/usecases/animationStateMachine/maskResolver.ts";
import { sampleState } from "@core/usecases/animationStateMachine/sampleState.ts";
import type { SampleContext } from "@core/usecases/animationStateMachine/sampleState.ts";
import {
  advanceCursor,
  createCursor,
  normalizedTime,
  remainingSeconds,
  syncCursorTo,
} from "@core/usecases/animationStateMachine/timelineCursor.ts";
import type {
  Cursor,
  InputSnapshot,
  LayerRuntime,
  PoseAccumulator,
  StateSample,
} from "@core/usecases/animationStateMachine/types.ts";

export type EmitFn = <K extends keyof MachineEvents>(name: K, payload: MachineEvents[K]) => void;

/* ── Lookups ─────────────────────────────────────────────────────────── */

export function stateById(layer: LayerDef, id: string): StateDef | null {
  for (const state of layer.states) {
    if (state.id === id) return state;
  }
  return null;
}

export function layerById(definition: MachineDefinition, id: string): LayerDef | null {
  for (const layer of definition.layers) {
    if (layer.id === id) return layer;
  }
  return null;
}

export function timelineById(definition: MachineDefinition, id: string): TimelineDef | null {
  for (const timeline of definition.timelines ?? []) {
    if (timeline.id === id) return timeline;
  }
  return null;
}

/**
 * How long a state runs, in seconds.
 *
 * A timeline's duration wins over the inline clip's: the timeline is the authority for
 * normalized time (§5.2), and a state that references one is a *phase* over it, so two
 * states sharing a timeline must not disagree about its length. A blend space has no
 * time of its own — it is a point in a space — so its duration is the longest child's,
 * which is what a cue or an `exitTime` should read.
 */
export function stateDuration(
  definition: MachineDefinition,
  resolver: AssetResolver,
  state: StateDef,
): number {
  switch (state.type) {
    case "clip": {
      if (state.timeline != null) {
        const timeline = timelineById(definition, state.timeline);
        if (timeline != null) return Math.max(timeline.duration, 0);
      }
      if (state.clip != null) {
        const clip = resolver.clip(state.clip);
        if (clip != null) return Math.max(clip.duration, 0);
      }
      if (state.morphCurve != null) {
        const curve = resolver.morphCurve(state.morphCurve);
        if (curve != null) return Math.max(curve.duration, 0);
      }
      return 1;
    }
    case "blend1d":
    case "blend2d": {
      let longest = 0;
      for (const child of state.children) {
        longest = Math.max(longest, childDuration(definition, resolver, child));
      }
      return longest > 0 ? longest : 1;
    }
    /* A direct state reads its inputs and an exit stub does nothing: neither has a time
       axis, so a fade into one is a fixed number of seconds, not a phase of something. */
    case "direct":
    case "exit":
      return 1;
    default:
      return 1;
  }
}

export function childDuration(
  definition: MachineDefinition,
  resolver: AssetResolver,
  child: {
    clip?: string | undefined;
    morphCurve?: string | undefined;
    timeline?: string | undefined;
  },
): number {
  if (child.timeline != null) {
    const timeline = timelineById(definition, child.timeline);
    if (timeline != null) return Math.max(timeline.duration, 0);
  }
  if (child.clip != null) {
    const clip = resolver.clip(child.clip);
    if (clip != null) return Math.max(clip.duration, 0);
  }
  if (child.morphCurve != null) {
    const curve = resolver.morphCurve(child.morphCurve);
    if (curve != null) return Math.max(curve.duration, 0);
  }
  return 1;
}

/** A cursor for a state's first frame, honouring the timeline's style and `startAt`. */
export function createStateCursor(
  definition: MachineDefinition,
  resolver: AssetResolver,
  state: StateDef,
  rng: () => number,
): Cursor {
  const timeline =
    state.type === "clip" && state.timeline != null
      ? timelineById(definition, state.timeline)
      : null;
  return createCursor(
    timeline ?? undefined,
    stateDuration(definition, resolver, state),
    state.startAt,
    rng,
  );
}

/** The key a blend child's cursor is stored under: `stateId:index`, per `sampleState`. */
export function childCursorKey(stateId: string, index: number): string {
  return `${stateId}:${String(index)}`;
}

/* ── Layer runtime ───────────────────────────────────────────────────── */

export function createLayerRuntime(layer: LayerDef): LayerRuntime {
  return {
    layerId: layer.id,
    activeStateId: null,
    cursor: null,
    childCursors: new Map(),
    transition: null,
    hysteresis: new Map(),
    consumedTriggers: new Set(),
    enabled: true,
    weightOverride: null,
    started: false,
    complete: false,
    frozenFromPose: null,
    queued: null,
    inFlightTriggers: new Set(),
    progress: 0,
    speed: 1,
  };
}

/** The speed a state runs at: authored speed × time scale × the speed curve's slope. */
export function resolveStateSpeed(
  state: StateDef,
  inputs: InputSnapshot,
  epsilon: number,
  progress: number,
  timeline?: TimelineDef,
): number {
  /*
   * The **timeline is the authority** on speed when a state references one — that is what
   * `timeline.speed` being on the timeline means. Reading only `state.speed` made a
   * `speed: -1` timeline play forwards, with nothing to indicate the field was ignored.
   * The state's own `speed`/`timeScale` still multiply on top, so a one-off override works.
   */
  const base =
    resolveSpeed(state.speed ?? timeline?.speed, 1, inputs, epsilon) * (state.timeScale ?? 1);
  const curve = state.speedCurve ?? timeline?.speedCurve;
  if (curve == null) return base;
  return base * curveSlope(curve, progress);
}

/** The timeline a state references, or `undefined` for the inline form. */
export function stateTimeline(
  definition: MachineDefinition,
  state: StateDef,
): TimelineDef | undefined {
  if (state.type !== "clip" || state.timeline == null) return undefined;
  return timelineById(definition, state.timeline) ?? undefined;
}

/**
 * The local slope of a speed curve, as a multiplier.
 *
 * `speedCurve` is authored as a *position* curve (§5.4), so the speed at a phase is its
 * derivative — not the curve's value. Read as a value it would flatten a `smoothstep`
 * into a constant 1 and freeze an `easeOut` at its plateau; sampled as a slope over one
 * 240 Hz step it means "how fast the phase is moving here", which is what a speed curve
 * is for. Clamped so a deliberately flat curve still runs at 5 % rather than 0 — a clip
 * that stops is `speed: 0`, which is a different authoring decision.
 */
function curveSlope(curve: Easing, progress: number): number {
  const delta = 1 / 240;
  const ahead = applyCurve(clamp(progress + delta, 0, 1), curve);
  const here = applyCurve(clamp(progress, 0, 1), curve);
  const slope = (ahead - here) / delta;
  if (!Number.isFinite(slope)) return 1;
  return clamp(slope, 0.05, 20);
}

/* ── Markers ─────────────────────────────────────────────────────────── */

/** Markers crossed between two normalized times, wrapping when the cursor looped. */
export function markersCrossed(
  markers: readonly MarkerDef[],
  fromNormalized: number,
  toNormalized: number,
  wrapped: boolean,
): MarkerDef[] {
  if (markers.length === 0) return [];
  /* A loop left no phase unvisited, so every marker is due exactly once — including one
     at 0 that the wrap just landed on. */
  if (wrapped) return [...markers];
  if (toNormalized === fromNormalized) return [];
  const low = Math.min(fromNormalized, toNormalized);
  const high = Math.max(fromNormalized, toNormalized);
  return markers.filter((marker) => marker.time > low && marker.time <= high);
}

/* ── Entry ───────────────────────────────────────────────────────────── */

export interface EntryOptions {
  layer: LayerDef;
  layerRuntime: LayerRuntime;
  inputs: InputSnapshot;
  epsilon: number;
}

/**
 * The layer's Entry, resolved once (§9.1).
 *
 * The first entry whose condition holds wins and the last is unconditional — the
 * validator enforces the second half, so this cannot fall through without the definition
 * having been rejected first.
 */
export function resolveEntry(options: EntryOptions): TransitionDef | null {
  const { layer, layerRuntime, inputs, epsilon } = options;
  for (const entry of layer.entry) {
    if (
      entry.when != null &&
      !evalCondition(entry.when, {
        inputs,
        memory: layerRuntime.hysteresis,
        consumed: layerRuntime.consumedTriggers,
        epsilon,
        site: `${layer.id}|entry`,
      })
    ) {
      continue;
    }
    return {
      from: "",
      to: entry.to,
      duration: entry.fade ?? 0,
      ...(entry.easing == null ? {} : { easing: entry.easing }),
    };
  }
  return null;
}

export interface StartLayerOptions extends EntryOptions {
  definition: MachineDefinition;
  resolver: AssetResolver;
  rng: () => number;
  entry: TransitionDef;
}

export function startLayer(options: StartLayerOptions): void {
  const { layer, layerRuntime, definition, resolver, rng, entry } = options;
  const state = stateById(layer, entry.to);
  if (state == null) return;

  const cursor = createStateCursor(definition, resolver, state, rng);
  layerRuntime.activeStateId = state.id;
  layerRuntime.cursor = cursor;
  layerRuntime.progress = 0;
  layerRuntime.started = true;
  layerRuntime.complete = state.type === "exit";

  /* An Entry with a fade has nothing to fade *from* — there is no previous pose — so the
     fade scales the state up from an empty pose. A record with `from: ""` is exactly
     that, and it is why `from` may be the empty string. */
  const duration = entry.duration ?? state.entryFade ?? 0;
  layerRuntime.transition =
    duration > 0
      ? {
          from: "",
          to: state.id,
          elapsed: 0,
          duration,
          source: "frozen",
          policy: "interrupt",
          frozenFrom: emptyPose(),
          startToTime: cursor.time,
          easing: entry.easing,
          fromCursor: null,
          toDuration: stateDuration(definition, resolver, state),
        }
      : null;
}

/* ── Fades ───────────────────────────────────────────────────────────── */

export interface BeginTransitionOptions {
  definition: MachineDefinition;
  resolver: AssetResolver;
  layer: LayerDef;
  layerRuntime: LayerRuntime;
  transition: TransitionDef;
  rng: () => number;
  /** Fallback fade for a cut that names none. `0` is a hard cut. */
  defaultDuration: number;
  /** True for `forceTransition`, which bypasses the `ignore` policy but not the others. */
  forced?: boolean;
}

export type CutResult =
  | { kind: "started" }
  | { kind: "queued" }
  | { kind: "blocked"; reason: "interruption" | "queue" };

/**
 * Cut to `transition.to`, applying the interruption policy to any fade in flight (§8.2).
 *
 * The result is reported rather than swallowed: a dropped cut that emitted nothing looks
 * exactly like a condition that never fired, which is the hardest class of bug to find in
 * a state machine.
 */
export function beginTransition(options: BeginTransitionOptions): CutResult {
  const { definition, resolver, layer, layerRuntime, transition, rng, forced } = options;
  const to = stateById(layer, transition.to);
  if (to == null) return { kind: "blocked", reason: "interruption" };

  const inFlight = layerRuntime.transition;
  const policy: InterruptionPolicy =
    transition.interruption ??
    (inFlight == null ? "interrupt" : (definition.options?.defaultInterruption ?? "interrupt"));

  if (inFlight != null && forced !== true) {
    if (policy === "ignore") return { kind: "blocked", reason: "interruption" };
    if (policy === "queue") {
      /* Depth 1, last-wins (§8.2): a second queued cut replaces the first rather than
         growing a backlog that would play out seconds later. */
      layerRuntime.queued = { transition, forced: false };
      return { kind: "queued" };
    }
  }

  const toDuration = stateDuration(definition, resolver, to);
  const duration = resolveFadeDuration(transition, to, layerRuntime, options.defaultDuration);

  /* `syncTime` re-anchors the incoming cursor to the outgoing state's *normalized* time,
     and it is read before the swap: afterwards `layerRuntime.cursor` is the new state's. */
  const previousCursor = layerRuntime.cursor;
  const fromNormalized =
    previousCursor == null ? 0 : normalizedTime(previousCursor, previousCursor.duration);

  const incoming = createStateCursor(definition, resolver, to, rng);
  if (transition.syncTime === true) {
    const synced = syncCursorTo(incoming, fromNormalized, toDuration);
    incoming.time = synced.time;
  }

  const previous = layerRuntime.activeStateId;

  /* The outgoing side. A fade over a fade under `interrupt` freezes the *current blended
     pose* — restarting from the old state's pose would jump back to a pose the viewer is
     not looking at. `interruptKeepPlaying` keeps the cursor alive instead. A plain cut has
     no in-flight record, so it is live. */
  const live = inFlight == null || policy === "interruptKeepPlaying";
  let frozenFrom: PoseAccumulator | null = null;
  let fromCursor: Cursor | null = live ? (previousCursor ?? null) : null;
  if (!live) {
    if (inFlight?.frozenFrom != null) {
      frozenFrom = clonePose(inFlight.frozenFrom);
      fromCursor = null;
    } else if (layerRuntime.frozenFromPose != null) {
      frozenFrom = clonePose(layerRuntime.frozenFromPose);
      fromCursor = null;
    } else {
      frozenFrom = emptyPose();
      fromCursor = null;
    }
  }

  layerRuntime.activeStateId = to.id;
  layerRuntime.cursor = incoming;
  layerRuntime.progress = 0;
  layerRuntime.complete = to.type === "exit";
  layerRuntime.queued = null;
  layerRuntime.transition =
    duration > 0
      ? {
          from: previous ?? "",
          to: to.id,
          elapsed: 0,
          duration,
          source: fromCursor == null ? "frozen" : "live",
          policy,
          frozenFrom,
          startToTime: incoming.time,
          easing: transition.easing ?? transition.fade?.easing,
          fromCursor,
          toDuration,
        }
      : null;

  return { kind: "started" };
}

function resolveFadeDuration(
  transition: TransitionDef,
  to: StateDef,
  layerRuntime: LayerRuntime,
  defaultDuration: number,
): number {
  const fade = transition.fade;
  if (fade != null) {
    /* A `normalized` fade is a fraction of the **from** state's clip duration (§8.1), and
       it is resolved at cut time — that is why a longer outgoing clip gets a longer
       fade instead of a fade that looks truncated. */
    return fade.mode === "normalized"
      ? Math.max(0, fade.duration * (layerRuntime.cursor?.duration ?? 1))
      : Math.max(0, fade.duration);
  }
  return Math.max(0, transition.duration ?? to.entryFade ?? defaultDuration);
}

/**
 * Advance the fade in flight. Returns the eased fraction to blend at this frame.
 *
 * A finished fade clears the record, and a queued cut (if any) starts immediately: the
 * queue exists to *delay* a cut to the end of the current one, so waiting a frame would
 * show the paused pose for one frame, which reads as a stutter.
 */
export function advanceTransition(
  layerRuntime: LayerRuntime,
  dt: number,
  onQueued: (transition: TransitionDef) => void,
): number {
  const record = layerRuntime.transition;
  if (record == null) return 1;

  record.elapsed = Math.min(record.elapsed + dt, record.duration);
  const linear = record.duration > 0 ? record.elapsed / record.duration : 1;
  const fraction = easingFn(record.easing)(linear);

  if (linear >= 1) {
    layerRuntime.transition = null;
    const queued = layerRuntime.queued;
    if (queued != null) {
      layerRuntime.queued = null;
      onQueued(queued.transition);
    }
    return 1;
  }
  return fraction;
}

/* ── The per-layer frame ─────────────────────────────────────────────── */

export interface LayerFrameOptions {
  dt: number;
  rotationBlend: "slerp" | "nlerp";
}

export interface LayerFrame {
  /** The incoming state's sample, already blended with the outgoing side. */
  sample: StateSample;
  /** Normalized progress of the incoming state, for `getActiveState` and `exitTime`. */
  progress: number;
  speed: number;
}

/**
 * Advance one layer by `dt` and return its composed sample.
 *
 * The sequence is deliberate: the cursor advances, then the sample is taken at the new
 * time, then `progress` is published. A condition reading `exitTime` therefore compares
 * against where the state *is*, not where it was one frame ago.
 */
export function advanceLayerFrame(
  definition: MachineDefinition,
  layer: LayerDef,
  layerRuntime: LayerRuntime,
  sampleCtx: SampleContext,
  options: LayerFrameOptions,
  emit: EmitFn,
): LayerFrame | null {
  const stateId = layerRuntime.activeStateId;
  const cursor = layerRuntime.cursor;
  if (stateId == null || cursor == null) return null;

  const state = stateById(layer, stateId);
  if (state == null) return null;

  const duration = Math.max(cursor.duration, 0);
  const fromNormalized = duration > 0 ? cursor.time / duration : 0;
  const speed = resolveStateSpeed(
    state,
    sampleCtx.inputs,
    sampleCtx.epsilon,
    fromNormalized,
    stateTimeline(definition, state),
  );
  layerRuntime.speed = speed;

  const step = advanceCursor(cursor, options.dt, speed, duration);
  const toNormalized = duration > 0 ? step.time / duration : 0;

  emitMarkers(definition, layer, state, fromNormalized, toNormalized, step.wrapped, emit);

  cursor.time = step.time;
  cursor.direction = step.direction;
  cursor.loops = step.loops;
  cursor.finished = step.finished;
  layerRuntime.progress = clamp(toNormalized, 0, 1);

  advanceChildren(definition, state, layerRuntime, sampleCtx, options.dt);

  const incoming = sampleState(state, cursor, sampleCtx);
  const record = layerRuntime.transition;
  const fraction =
    record == null
      ? 1
      : easingFn(record.easing)(
          record.duration > 0 ? clamp(record.elapsed / record.duration, 0, 1) : 1,
        );
  /* The pose a `interrupt` cut would freeze from is this frame's incoming side — keeping
     it here means the next cut does not have to re-sample a state that is already gone. */
  if (record != null) layerRuntime.frozenFromPose = poseAsAccumulator(incoming);

  if (record == null) {
    layerRuntime.frozenFromPose = poseAsAccumulator(incoming);
    return { sample: incoming, progress: layerRuntime.progress, speed };
  }

  const fromPose = sampleOutgoing(definition, layer, record, sampleCtx, options.dt);
  const blended = blendPoses(fromPose, poseAsAccumulator(incoming), fraction, OPEN_MASK, {
    rotationBlend: options.rotationBlend,
    morphRange: sampleCtx.morphRange,
  });

  return {
    sample: poseAsSample(blended, incoming),
    progress: layerRuntime.progress,
    speed,
  };
}

function emitMarkers(
  definition: MachineDefinition,
  layer: LayerDef,
  state: StateDef,
  fromNormalized: number,
  toNormalized: number,
  wrapped: boolean,
  emit: EmitFn,
): void {
  const own = markersCrossed(state.markers ?? [], fromNormalized, toNormalized, wrapped);
  const timelineMarkers =
    state.type === "clip" && state.timeline != null
      ? (timelineById(definition, state.timeline)?.markers ?? [])
      : [];
  const due = markersCrossed(timelineMarkers, fromNormalized, toNormalized, wrapped);
  for (const marker of [...own, ...due]) {
    emit("marker", {
      layer: layer.id,
      state: state.id,
      name: marker.name,
      ...(marker.payload == null ? {} : { payload: marker.payload }),
    });
  }
}

function sampleOutgoing(
  definition: MachineDefinition,
  layer: LayerDef,
  record: { from: string; frozenFrom: PoseAccumulator | null; fromCursor: Cursor | null },
  sampleCtx: SampleContext,
  dt: number,
): PoseAccumulator {
  if (record.frozenFrom != null) return record.frozenFrom;

  const fromState = record.from === "" ? null : stateById(layer, record.from);
  const fromCursor = record.fromCursor;
  if (fromState == null || fromCursor == null) return emptyPose();

  const speed = resolveStateSpeed(
    fromState,
    sampleCtx.inputs,
    sampleCtx.epsilon,
    normalizedTime(fromCursor, fromCursor.duration),
    stateTimeline(definition, fromState),
  );
  const advanced = advanceCursor(fromCursor, dt, speed, fromCursor.duration);
  fromCursor.time = advanced.time;
  fromCursor.direction = advanced.direction;
  fromCursor.loops = advanced.loops;
  fromCursor.finished = advanced.finished;
  return poseAsAccumulator(sampleState(fromState, fromCursor, sampleCtx));
}

function advanceChildren(
  definition: MachineDefinition,
  state: StateDef,
  layerRuntime: LayerRuntime,
  sampleCtx: SampleContext,
  dt: number,
): void {
  if (state.type !== "blend1d" && state.type !== "blend2d") return;
  state.children.forEach((child, index) => {
    const key = childCursorKey(state.id, index);
    let cursor = layerRuntime.childCursors.get(key);
    if (cursor == null) {
      const timeline = child.timeline != null ? timelineById(definition, child.timeline) : null;
      cursor = createCursor(
        timeline ?? undefined,
        childDuration(definition, sampleCtx.resolver, child),
        undefined,
        sampleCtx.rng,
      );
      layerRuntime.childCursors.set(key, cursor);
    }
    const speed = (child.speed ?? 1) * (child.timeScale ?? 1);
    const advanced = advanceCursor(cursor, dt, speed, cursor.duration);
    cursor.time = advanced.time;
    cursor.direction = advanced.direction;
    cursor.loops = advanced.loops;
    cursor.finished = advanced.finished;
  });
}

/* ── Pose ↔ sample ───────────────────────────────────────────────────── */

export function poseAsAccumulator(sample: StateSample): PoseAccumulator {
  return {
    bones: sample.bones,
    morphs: sample.morphs,
    bonesDirty: sample.bones.size > 0,
    morphsDirty: sample.morphs.size > 0,
  };
}

/**
 * A blended pose back as a sample.
 *
 * `progress`, `speed` and `markers` come from the incoming state because those are what
 * `getActiveState` reports during a fade — the outgoing state is on its way out, and a
 * progress bar that jumped back to the old state's would be wrong the moment the cut
 * happened.
 */
export function poseAsSample(pose: PoseAccumulator, incoming: StateSample): StateSample {
  return {
    bones: pose.bones,
    morphs: pose.morphs,
    markers: incoming.markers,
    progress: incoming.progress,
    speed: incoming.speed,
  };
}

/* ── Evaluation ──────────────────────────────────────────────────────── */

export interface EvaluateOptions {
  layer: LayerDef;
  layerRuntime: LayerRuntime;
  inputs: InputSnapshot;
  epsilon: number;
  /** Set by `forceTransition`; bypasses conditions but not the interruption policy. */
  forcedTo?: string | undefined;
}

/**
 * The transition this layer wants this frame, if any (§8.1).
 *
 * State-local transitions are evaluated before `anyState`, and the first eligible one
 * wins. A transition whose `from` names no state is skipped rather than treated as
 * "from anywhere" — that is `anyState`'s job, and conflating the two makes a typo'd `from`
 * silently fire on every state.
 */
export function evaluateTransitions(options: EvaluateOptions): TransitionDef | null {
  const { layer, layerRuntime, inputs, epsilon, forcedTo } = options;
  if (forcedTo != null) return { from: layerRuntime.activeStateId ?? "", to: forcedTo };

  const active = layerRuntime.activeStateId;
  const candidates: TransitionDef[] = [];
  for (const transition of layer.transitions) {
    if (active == null || transition.from !== active) continue;
    candidates.push(transition);
  }
  for (const transition of layer.anyState) candidates.push(transition);

  for (const transition of candidates) {
    /* `exitTime` is a "not before" gate on the outgoing state's progress: a cut authored
       at 0.8 waits until the clip is 80 % through. */
    if (transition.exitTime != null && layerRuntime.progress < transition.exitTime) continue;

    const consumed = new Set<string>();
    const eligible =
      transition.when == null ||
      evalCondition(transition.when, {
        inputs,
        memory: layerRuntime.hysteresis,
        consumed,
        epsilon,
        site: `${layer.id}|${transition.from}->${transition.to}`,
      });
    if (!eligible) continue;

    if (transition.consumeTriggers !== false) {
      for (const name of consumed) layerRuntime.inFlightTriggers.add(name);
    }
    return transition;
  }
  return null;
}

/* ── Readout ─────────────────────────────────────────────────────────── */

export function layerProgress(layerRuntime: LayerRuntime): number {
  return clamp(layerRuntime.progress, 0, 1);
}

export function layerRemaining(layerRuntime: LayerRuntime): number {
  if (layerRuntime.cursor == null) return 0;
  return remainingSeconds(layerRuntime.cursor, layerRuntime.cursor.duration);
}

/**
 * Where a normalized seek lands a cursor.
 *
 * A seek into a `pingPong` or a `clampForever` past the turnaround is deliberately
 * allowed a normalized value outside `[0, 1]` only through `clampForever`'s own time;
 * this clamp is the author's 0..1 phase, and it clears `finished` so a state that had
 * ended can be replayed by seeking backwards.
 */
export function seekCursor(cursor: Cursor, normalized: number): void {
  const synced = syncCursorTo(cursor, clamp(normalized, 0, 1), cursor.duration);
  cursor.time = synced.time;
  cursor.finished = false;
}
