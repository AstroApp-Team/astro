/**
 * The machine (§11.2, §12).
 *
 * The tick order is fixed and is the reason this file exists at all:
 *
 * ```text
 * advance inputs → ingest pointers → evaluate transitions → advance fades → sample states
 *   → blend layers → apply constraints → publish the pose
 * ```
 *
 * Two consequences worth stating, because both have been bugs elsewhere:
 *
 * - A transition sees the inputs of **this** frame and the progress of the **last** one.
 *   Reading progress after advancing would let an `exitTime: 1` cut fire on the frame the
 *   clip ended and skip its last pose.
 * - A pointer listener's action lands in the input store at step 2, so it is visible to
 *   step 3 of the *same* frame — a click that fires a trigger and a transition that
 *   consumes it happen in one tick, not two.
 *
 * The machine owns no clock: `step(dt, elapsed)` is called by the host once per frame.
 * `elapsed` is the host's own clock, carried so a paused machine keeps its phase and a
 * debug overlay can timestamp a marker without reading `performance.now()` in core.
 */

import type { AssetResolver } from "@core/interfaces/animationAssets.ts";
import type {
  ActiveStateInfo,
  ActiveTransitionInfo,
  LayerDef,
  Machine,
  MachineDefinition,
  MachineEventName,
  MachineEvents,
  MachineOutput,
  PointerHit,
  RigDescription,
  RootMotion,
  Vec3,
} from "@core/models/animationStateMachine.ts";
import {
  clearBus,
  createEventBus,
  emit as emitEvent,
  subscribe,
} from "@core/usecases/animationStateMachine/actionExecutor.ts";
import type { EventBus } from "@core/usecases/animationStateMachine/actionExecutor.ts";
import { toMachineOutput } from "@core/usecases/animationStateMachine/blendPoses.ts";
import { buildConstraintPlan } from "@core/usecases/animationStateMachine/applyConstraints.ts";
import type { ConstraintPlan } from "@core/usecases/animationStateMachine/applyConstraints.ts";
import { emptyPose } from "@core/usecases/animationStateMachine/blendPoses.ts";
import {
  advanceInputs,
  createInputStore,
  fireTrigger,
  getBoolean,
  getNumber,
  resetInputs,
  setBoolean,
  setNumber,
  snapshotInputs,
} from "@core/usecases/animationStateMachine/inputStore.ts";
import type { InputStore } from "@core/usecases/animationStateMachine/inputStore.ts";
import { composeFrame } from "@core/usecases/animationStateMachine/layerComposer.ts";
import { resolveAllMasks } from "@core/usecases/animationStateMachine/maskResolver.ts";
import { resolveLayerMasks } from "@core/usecases/animationStateMachine/layerComposer.ts";
import {
  applyQueuedActions,
  ingestPointerHits,
} from "@core/usecases/animationStateMachine/pointerListeners.ts";
import type { SampleContext } from "@core/usecases/animationStateMachine/sampleState.ts";
import {
  advanceLayerFrame,
  advanceTransition,
  beginTransition,
  createLayerRuntime,
  evaluateTransitions,
  layerProgress,
  layerRemaining,
  resolveEntry,
  seekCursor,
  startLayer,
} from "@core/usecases/animationStateMachine/transitionEngine.ts";
import type {
  LayerRuntime,
  MachineRuntime,
  StateSample,
} from "@core/usecases/animationStateMachine/types.ts";
import {
  MachineDefinitionError,
  validateDefinition,
} from "@core/usecases/animationStateMachine/validateDefinition.ts";

export interface CreateMachineOptions {
  /** Asset lookup. Without one every clip reference resolves to null and poses are empty. */
  resolver?: AssetResolver;
  /** Bone and morph names, for the validator and for constraint `pose` targets. */
  rig?: RigDescription;
  rotationBlend?: "slerp" | "nlerp";
  morphRange?: [number, number];
  /** Seed for the injected RNG. A machine never calls `Math.random` itself (§12.5). */
  seed?: number;
  /** Numbers and booleans to set before the first frame. */
  initialInputs?: Record<string, number | boolean>;
  /** Fade used by a cut that names none. Default 0 (a hard cut). */
  defaultFade?: number;
}

/** A copy of the empty resolver: no assets, so every pose is empty and nothing throws. */
const EMPTY_RESOLVER: AssetResolver = {
  clip: () => null,
  morphCurve: () => null,
};

/**
 * `mulberry32` — a 32-bit PRNG with a good enough distribution for a state machine's
 * `startAt: "random"`, and, more importantly, a **seedable** one: a test that plays a
 * random start twice must see the same pose.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a machine.
 *
 * A definition that fails validation is **not loaded** (§12.1): the report is thrown as a
 * `MachineDefinitionError` so the caller can list every problem, rather than a machine
 * that silently plays nothing.
 */
export function createMachine(
  definition: MachineDefinition,
  options: CreateMachineOptions = {},
): Machine {
  const report = validateDefinition(definition, options.rig, options.resolver);
  if (!report.ok) throw new MachineDefinitionError(report);

  const resolver = options.resolver ?? EMPTY_RESOLVER;
  const epsilon = definition.options?.epsilon ?? 1e-6;
  const rotationBlend = options.rotationBlend ?? definition.options?.rotationBlend ?? "slerp";
  const morphRange = options.morphRange ?? definition.options?.morphRange ?? [0, 1];
  const maxDt = definition.options?.maxDt ?? 1 / 30;
  const defaultFade = options.defaultFade ?? 0;
  const rng = mulberry32(options.seed ?? 1);

  const store: InputStore = createInputStore(
    definition.inputs,
    definition.options?.defaultTriggerTtl ?? Number.POSITIVE_INFINITY,
  );
  for (const [name, value] of Object.entries(options.initialInputs ?? {})) {
    if (typeof value === "number") setNumber(store, name, value);
    else setBoolean(store, name, value);
  }

  const groups = maskGroups(definition);
  const masks = resolveAllMasks(definition.masks, groups);
  const constraintPlan: ConstraintPlan | null = buildConstraintPlan(
    definition.constraints,
    masks,
    definition.masks,
  );

  const bus: EventBus = createEventBus();
  const emit = <K extends MachineEventName>(event: K, payload: MachineEvents[K]): void => {
    emitEvent(bus, event, payload);
  };

  /* Every declared tag, flattened once. A tag is an annotation, so the set is read-only
     after construction and `hasTag` is an O(1) lookup rather than a walk per call. */
  const tagSet = new Set<string>(definition.tags ?? []);
  for (const layer of definition.layers) {
    for (const tag of layer.tags ?? []) tagSet.add(tag);
    for (const transition of [...layer.transitions, ...layer.anyState]) {
      for (const tag of transition.tags ?? []) tagSet.add(tag);
    }
    for (const state of layer.states) {
      for (const tag of state.tags ?? []) tagSet.add(tag);
    }
  }

  /* Root motion is a delta between frames, so the previous root translation is kept here
     and the published value is reset on every frame that has no root bone. */
  let rootMotion: RootMotion = { translation: [0, 0, 0] };
  let previousRootPosition: Vec3 | null = null;

  const layerRuntimes = new Map<string, LayerRuntime>();
  for (const layer of definition.layers) {
    layerRuntimes.set(layer.id, createLayerRuntime(layer));
  }

  const runtime: MachineRuntime = {
    definition,
    options: {
      rotationBlend,
      maxChainDepth: definition.options?.maxChainDepth ?? 8,
      epsilon,
      defaultInterruption: definition.options?.defaultInterruption ?? "interrupt",
      maxDt,
      morphRange,
      defaultTriggerTtl: definition.options?.defaultTriggerTtl ?? Number.POSITIVE_INFINITY,
    },
    // The store *is* the input state: `InputStore` is a superset of the four maps the
    // runtime declares, so a second copy would be two places to keep in sync.
    inputs: store,
    inputDefs: store.defs,
    layers: definition.layers.map((layer) => {
      const layerRuntime = layerRuntimes.get(layer.id);
      if (layerRuntime == null) throw new Error(`layer ${layer.id} has no runtime`);
      return layerRuntime;
    }),
    pendingPointers: [],
    pointers: new Map(),
    pendingActions: [],
    dragOwner: new Map(),
    hover: new Map(),
    lastClick: null,
    listenersEnabled: true,
    elapsed: 0,
    rng,
    queuedListenerActions: [],
    nextDerived: new Map(),
    constraintLastGood: new Map(),
  };

  /* Masks are resolved once, not per frame: an inline mask that `extends` a named one would
     otherwise re-walk the table 60 times a second for a value that never changes. */
  const layerMasks = resolveLayerMasks(definition, masks, groups);

  /* `forceTransition` is a request that lands on the next `step`, not a synchronous cut:
     cutting mid-frame would sample a state the frame has already advanced past. */
  let forcedQueue = new Map<string, string>();
  let disposed = false;

  const machine: Machine = {
    definition,

    setNumber(name, value) {
      setNumber(store, name, value);
    },
    setBoolean(name, value) {
      setBoolean(store, name, value);
    },
    fire(name) {
      fireTrigger(store, name);
    },
    getNumber(name) {
      return getNumber(store, name);
    },
    getBoolean(name) {
      return getBoolean(store, name);
    },

    pushPointer(hit: PointerHit) {
      runtime.pendingPointers.push(hit);
    },

    step(dt, elapsed) {
      if (disposed) return emptyOutput();
      const clamped = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), maxDt);
      runtime.elapsed = elapsed;

      /* 1. Inputs. Smoothing and trigger TTLs run on the clamped dt, so a tab that was
         backgrounded for a minute resolves one 1/30 s step instead of sixty. */
      advanceInputs(store, clamped);
      /* Constraint output published last frame becomes readable this frame. This is what
         lets a constraint read its own last value without a cycle (§6.2). */
      for (const [name, value] of runtime.nextDerived) store.derived.set(name, value);
      runtime.nextDerived.clear();

      /* 2. Pointers → listener actions. Applying the queue here, before the transition
         pass, is what makes a click and the cut it causes land in one tick. */
      /*
       * Pointers are ingested even when the definition declares no listeners: pointer
       * *state* is also what a `pointer` constraint reads, and gating the ingest on
       * `listeners` left the constraint with an empty map and a silent no-op.
       */
      ingestPointerHits(
        runtime.pendingPointers,
        runtime.listenersEnabled ? (definition.listeners ?? []) : [],
        runtime,
        (event, payload) => {
          if (event === "listener") emit("listener", payload);
        },
      );
      runtime.pendingPointers.length = 0;
      applyQueuedActions(runtime, store);

      const inputs = snapshotInputs(store);

      const sampleCtx: SampleContext = {
        inputs,
        resolver,
        rng,
        epsilon,
        morphRange,
        childCursors: new Map(),
      };

      /* 3. Transitions, then 4. fades. A layer that has not started resolves its Entry;
         a layer mid-fade still evaluates, which is how `interrupt` cuts land. */
      const forced = forcedQueue;
      forcedQueue = new Map();
      for (const layer of definition.layers) {
        const layerRuntime = layerRuntimes.get(layer.id);
        if (layerRuntime == null || !layerRuntime.enabled) continue;

        if (!layerRuntime.started) {
          const entry = resolveEntry({ layer, layerRuntime, inputs, epsilon });
          if (entry == null) continue;
          startLayer({ layer, layerRuntime, definition, resolver, rng, entry, inputs, epsilon });
          emit("stateEnter", { layer: layer.id, state: entry.to });
          continue;
        }

        const wanted = evaluateTransitions({
          layer,
          layerRuntime,
          inputs,
          epsilon,
          forcedTo: forced.get(layer.id),
        });
        if (wanted != null) {
          const result = beginTransition({
            definition,
            resolver,
            layer,
            layerRuntime,
            transition: wanted,
            rng,
            defaultDuration: defaultFade,
            forced: forced.has(layer.id),
          });
          if (result.kind === "started") {
            emit("stateExit", { layer: layer.id, state: wanted.from });
            emit("transition", { layer: layer.id, from: wanted.from, to: wanted.to });
            emit("stateEnter", { layer: layer.id, state: wanted.to });
            /* A fade of duration 0 builds no record, so there is nothing to finish later:
               the cut is complete the frame it starts, and a `once("transitionComplete")`
               that waited for it would wait forever. */
            if (layerRuntime.transition == null) {
              emit("transitionComplete", { layer: layer.id, from: wanted.from, to: wanted.to });
            }
          } else if (result.kind === "blocked") {
            emit("blocked", { layer: layer.id, to: wanted.to, reason: result.reason });
          }
        }

        const fading = layerRuntime.transition;
        advanceTransition(layerRuntime, clamped, (queuedTransition) => {
          const result = beginTransition({
            definition,
            resolver,
            layer,
            layerRuntime,
            transition: queuedTransition,
            rng,
            defaultDuration: defaultFade,
          });
          if (result.kind === "started") {
            emit("stateExit", { layer: layer.id, state: queuedTransition.from });
            emit("transition", {
              layer: layer.id,
              from: queuedTransition.from,
              to: queuedTransition.to,
            });
            emit("stateEnter", { layer: layer.id, state: queuedTransition.to });
            if (layerRuntime.transition == null) {
              emit("transitionComplete", {
                layer: layer.id,
                from: queuedTransition.from,
                to: queuedTransition.to,
              });
            }
          }
        });

        /* The record that was in flight is gone: either it finished, or the queued cut
           replaced it. Only the first is a completion — the second is a cut interrupting a
           fade, which already reported itself through `transition`. */
        if (fading != null && layerRuntime.transition !== fading) {
          emit("transitionComplete", {
            layer: layer.id,
            from: fading.from,
            to: fading.to,
          });
        }
      }

      /* 5–6. Sample and blend. The child-cursor map is per frame and per layer: a blend
         child's cursor belongs to the layer's runtime, and passing one shared map would
         let two layers' walk cycles share a phase. */
      const samples = new Map<string, StateSample>();
      for (const layer of definition.layers) {
        const layerRuntime = layerRuntimes.get(layer.id);
        if (layerRuntime == null || !layerRuntime.enabled) continue;
        const layerCtx: SampleContext = { ...sampleCtx, childCursors: layerRuntime.childCursors };
        const frame = advanceLayerFrame(
          definition,
          layer,
          layerRuntime,
          layerCtx,
          { dt: clamped, rotationBlend },
          emit,
        );
        if (frame != null) samples.set(layer.id, frame.sample);
      }

      /* 7. Constraints. A cycle is frozen by the solver and reported through the bus; the
         last-good value lives on the runtime so a frozen constraint holds a pose rather
         than snapping to zero. */
      const composed = composeFrame({
        definition,
        layers: definition.layers,
        runtimes: layerRuntimes,
        samples,
        inputs,
        resolver,
        layerMasks,
        sampleCtx,
        rotationBlend,
        morphRange,
        constraintPlan,
        constraints: {
          inputs,
          pointers: runtime.pointers,
          ...(options.rig == null ? {} : { rig: options.rig }),
          morphRange,
          publish: runtime.nextDerived,
          lastGood: runtime.constraintLastGood,
          dt: clamped,
          reportCycle: (constraint, channel) => {
            emit("cycle", { constraint, channel });
          },
        },
      });

      /* Root motion: the root bone's translation delta this frame. Absent root bone is
         zero motion, not "unchanged" — the host adds the delta, so zero is a no-op. */
      const rootBone = definition.options?.rootBone;
      const rootPosition = rootBone == null ? undefined : composed.output.bones[rootBone]?.position;
      if (rootPosition == null) {
        previousRootPosition = null;
        rootMotion = { translation: [0, 0, 0] };
      } else if (previousRootPosition == null) {
        /* The first frame has no previous position, so it publishes no movement: a delta
           against zero would teleport the model to wherever the clip starts. */
        rootMotion = { translation: [0, 0, 0] };
        /* Copied, not referenced: the sampler is free to hand back the same array every
           frame (and does), so keeping the reference would make the next delta zero. */
        previousRootPosition = [...rootPosition] as Vec3;
      } else {
        rootMotion = {
          translation: [
            rootPosition[0] - previousRootPosition[0],
            rootPosition[1] - previousRootPosition[1],
            rootPosition[2] - previousRootPosition[2],
          ],
        };
        previousRootPosition = [rootPosition[0], rootPosition[1], rootPosition[2]];
      }

      return { ...composed.output, rootMotion };
    },

    on(event, listener) {
      return subscribe(bus, event, listener);
    },

    once(event, listener, filter) {
      let active = true;
      const unsubscribe = subscribe(bus, event, (payload) => {
        if (!active) return;
        if (filter != null && !filter(payload)) return;
        active = false;
        unsubscribe();
        listener(payload);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },

    hasTag(tag) {
      return tagSet.has(tag);
    },

    getSmoothedNumber(name) {
      const state = store.numbers.get(name);
      if (state == null) throw new Error(`unknown number input "${name}"`);
      return state.smoothed;
    },

    isTriggerPending(name) {
      return store.triggers.get(name)?.pending === true;
    },

    getRootMotion() {
      return rootMotion;
    },

    getActiveTransition(layerId) {
      const record = layerRuntimes.get(layerId)?.transition;
      if (record == null) return null;
      const info: ActiveTransitionInfo = {
        layer: layerId,
        from: record.from,
        to: record.to,
        elapsed: record.elapsed,
        duration: record.duration,
        normalized: record.duration > 0 ? record.elapsed / record.duration : 1,
        source: record.source,
      };
      return info;
    },

    getActiveState(layerId) {
      const layerRuntime = layerRuntimes.get(layerId);
      if (layerRuntime?.activeStateId == null) return null;
      const info: ActiveStateInfo = {
        layer: layerId,
        state: layerRuntime.activeStateId,
        progress: layerProgress(layerRuntime),
        remaining: layerRemaining(layerRuntime),
        speed: layerRuntime.speed,
      };
      return info;
    },

    setLayerWeight(layerId, weight) {
      const layerRuntime = layerRuntimes.get(layerId);
      if (layerRuntime != null) layerRuntime.weightOverride = weight;
    },

    setLayerEnabled(layerId, enabled) {
      const layerRuntime = layerRuntimes.get(layerId);
      if (layerRuntime == null) return;
      layerRuntime.enabled = enabled;
      /* Re-entry: a layer switched back on starts from its Entry rather than resuming a
         state nobody saw it leave. */
      if (enabled && !layerRuntime.started) layerRuntime.activeStateId = null;
    },

    forceTransition(layerId, to) {
      forcedQueue.set(layerId, to);
    },

    seek(layerId, normalizedTime) {
      const layerRuntime = layerRuntimes.get(layerId);
      if (layerRuntime?.cursor == null) return;
      seekCursor(layerRuntime.cursor, normalizedTime);
    },

    reset() {
      resetInputs(store);
      runtime.pointers.clear();
      runtime.pendingPointers.length = 0;
      runtime.queuedListenerActions.length = 0;
      runtime.nextDerived.clear();
      runtime.constraintLastGood.clear();
      runtime.lastClick = null;
      previousRootPosition = null;
      rootMotion = { translation: [0, 0, 0] };
      for (const layerRuntime of layerRuntimes.values()) {
        layerRuntime.activeStateId = null;
        layerRuntime.cursor = null;
        layerRuntime.childCursors.clear();
        layerRuntime.transition = null;
        layerRuntime.queued = null;
        layerRuntime.hysteresis.clear();
        layerRuntime.inFlightTriggers.clear();
        layerRuntime.consumedTriggers.clear();
        layerRuntime.weightOverride = null;
        layerRuntime.started = false;
        layerRuntime.complete = false;
        layerRuntime.progress = 0;
        layerRuntime.frozenFromPose = null;
      }
    },

    dispose() {
      disposed = true;
      clearBus(bus);
      runtime.pendingPointers.length = 0;
      runtime.queuedListenerActions.length = 0;
    },
  };

  return machine;
}

/** Test helper: the pose a machine would produce with no layers sampled. */
export function emptyOutput(): MachineOutput {
  return toMachineOutput(emptyPose());
}

export type { LayerDef };

/**
 * The group table the mask resolver wants.
 *
 * The definition declares morph groups as `{ mesh, target }` objects because that is how
 * they are authored and validated; the mask resolver keys its channels `mesh:target`, so
 * the conversion happens once, here, rather than in every mask lookup.
 */
function maskGroups(definition: MachineDefinition): {
  bones: ReadonlyMap<string, string[]>;
  morph: ReadonlyMap<string, string[]>;
} {
  const bones = new Map<string, string[]>();
  for (const [name, members] of Object.entries(definition.groups?.bones ?? {})) {
    bones.set(name, members);
  }
  const morph = new Map<string, string[]>();
  for (const [name, members] of Object.entries(definition.groups?.morph ?? {})) {
    morph.set(
      name,
      members.map((member) => `${member.mesh}:${member.target}`),
    );
  }
  return { bones, morph };
}
