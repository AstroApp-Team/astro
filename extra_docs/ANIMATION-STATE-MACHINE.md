# Animation & Mesh State Machine — Functional Specification

Status: **design only**. No implementation plan, no file-by-file breakdown. This document
defines behaviour, data model and consumer API for a declarative, Rive-inspired state
machine that drives 3D skeletal clips and mesh morph targets.

## 0. Goals and non-goals

**Goal.** Decouple application/game logic from low-level animation assets. Callers set
typed inputs and read state; they never name a clip, a bone or a morph-target index.

**Non-goals (this document).** Authoring UI, asset import, file layout, rendering
integration, retargeting, IK, physics, networking.

**Design constraints.**

- The machine is a **pure function of (definition, inputs, time)**. Given the same
  definition, the same input history and the same `dt` sequence, it produces the same
  pose and events. This makes it testable without a renderer.
- Definition is **data** (JSON-serializable), not code. Validation happens at load.
- The evaluator outputs an abstract **pose + morph weights** result. Applying it to a
  three.js skeleton/mesh is an adapter concern, outside this spec.
- Clips are referenced by **asset id** (string) inside the definition only. Consumers
  never see them.

## 1. Vocabulary

| Term          | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| Machine       | One loaded definition plus its runtime instance state.                         |
| Input         | A named, typed external parameter (`number`, `boolean`, `trigger`).            |
| Layer         | An independently running state graph with a weight, blend mode and mask.       |
| State         | A node in a layer that produces a _sample_ (clip, blend space, direct blend).  |
| Sample        | Output of a state at time `t`: bone transforms + morph weights (both sparse).  |
| Mask          | A filter over bones and morph targets limiting what a layer may write.         |
| Transition    | A directed edge with conditions, optional exit time, fade and interruption.    |
| Pose          | Per-bone local transform (position, quaternion, scale) for the whole skeleton. |
| Morph weights | Per-morph-target scalar, addressed by `(meshId, targetName)`.                  |
| Marker        | A named point on a clip timeline that emits an event when crossed.             |

## 2. Black-box input contract

All external control goes through inputs declared in the definition. Setting an unknown
name or a wrong type is a **loud error** (throws in dev, returns `false` + reports to
`onError` in production), never a silent no-op.

### 2.1 Input kinds

| Kind      | Value           | Persistence                    | Typical use                        |
| --------- | --------------- | ------------------------------ | ---------------------------------- |
| `number`  | finite `number` | Persists until set again       | `moveSpeed`, `aimPitch`, `jawOpen` |
| `boolean` | `boolean`       | Persists until set again       | `isGrounded`, `isAiming`           |
| `trigger` | none (a pulse)  | Consumed once, then auto-reset | `jump`, `flinch`                   |

### 2.2 Number semantics

- Declared with `default`, optional `min`/`max`. Writes are **clamped** to the range when
  given; `NaN`/`±Infinity` are rejected (error), never stored.
- Optional **smoothing** per input (`smoothTime` seconds, critically-damped). Conditions
  and blend weights read the _smoothed_ value; `getInput` returns the _raw_ target and
  `getSmoothedInput` the smoothed one. Default: no smoothing.

### 2.3 Trigger semantics (the sharp edge)

- `fire()` sets a pending flag. It does **not** transition immediately; it is evaluated
  at the next `update`.
- A trigger is **consumed** only when a transition that lists it in its conditions
  actually **fires**. If no transition consumes it in a frame it stays pending.
- Stale pulses expire: per-trigger `ttl` seconds (default `0.25`; `0` = same-frame only;
  `Infinity` = until consumed). An expired pulse is dropped and reported via
  `onTriggerExpired`.
- Multiple `fire()` calls before consumption **coalesce** into one pulse.
- One trigger can be consumed by **at most one** transition per frame. Resolution order
  is defined in §4.3 so this is deterministic.
- A trigger consumed in one layer is **not** visible to other layers in that frame
  unless it is declared `shared: true` (consumed per layer, expired globally).
  Default is `shared: false` — first layer by priority wins.

### 2.4 Boolean semantics

Plain level-triggered flag. Conditions see the value as of the start of the frame
(§4.1); writes during `update` callbacks apply next frame.

## 3. Layers, blend modes and 3D masks

### 3.1 Layers

- A machine has **1..N layers**. Layer 0 is the base. Each layer is an independent
  graph (own Entry / Exit / Any State, own current state, own transitions).
- Layers evaluate in **ascending `priority`** (ties: declaration order). Later layers
  composite on top of earlier ones.
- Each layer has a `weight` in `[0, 1]`. Weight can be a constant or bound to a `number`
  input (`weightInput`), enabling "turn aiming on smoothly".

### 3.2 Blend modes

| Mode       | Bones                                                                              | Morph targets                             |
| ---------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| `override` | `out = nlerp/lerp(below, layer, w·mask)` for each masked bone                      | `out = lerp(below, layer, w·mask)`        |
| `additive` | `out = below ∘ lerp(identity, delta, w·mask)` where `delta` = layer sample ∘ ref⁻¹ | `out = below + w·mask·(layer − refMorph)` |

Rules:

- **Additive needs a reference.** Each additive state or clip declares `additiveRef`:
  `{ clip, time }` (typically frame 0 of the same clip) or `"bindPose"`. Delta is
  computed as `sample ∘ inverse(ref)` per bone (rotation: `q · refᵀ`; translation and
  scale: difference/ratio) and `sample − ref` for morphs.
- Rotation blending is **shortest-path nlerp** by default; `slerp` selectable per
  machine for quality over cost. Weights below `epsilon` (`1e-4`) skip the layer.
- Morph weights are clamped to `[morphMin, morphMax]` (default `[0, 1]`; some rigs
  allow negatives or `>1`) **after** all layers, not per layer — so additive stacking
  can overshoot internally and clamp once.
- Override with weight `< 1` blends against whatever is below, including result of
  earlier additive layers.

### 3.3 3D target masks

A mask is a named, reusable filter, referenced by layers.

```text
Mask = {
  bones:   [{ root: BoneName, includeDescendants: boolean, weight: number }]  // default weight 1
  morphs:  [{ mesh: MeshId, groups|targets: [...], weight: number }]
  default: { bones: 0 | 1, morphs: 0 | 1 }   // value for anything not listed
}
```

- **Bone subtrees:** `root: "spine_02", includeDescendants: true` selects the whole
  upper body. Per-entry `weight` allows a soft falloff (e.g. `spine_01: 0.3`,
  `spine_02: 0.7`, `spine_03: 1.0`) so the blend does not pop at the waist.
- **Morph groups:** morphs are organised into named **groups** declared on the machine
  (e.g. `face.brows`, `face.mouth`, `body.corrective`) so a layer can own "facial blend
  shapes" without listing 52 targets. A mask can list groups, individual targets, or
  both. Groups can overlap; a target's mask weight is the **max** across matching
  entries.
- **Composition:** a mask can `extend` other masks and `subtract` others (e.g.
  `upperBody` minus `hands`).
- **Effective weight per channel** = `layer.weight × mask.weight(channel) × blendModeFactor`.
  Channels the mask excludes are **untouched** (the layer is skipped for them, not
  blended with identity).
- A state's sample is also **sparse by nature**: a clip that animates only the face
  writes nothing to the body. The mask can only _narrow_ what a state writes, never
  widen it.

## 4. Runtime evaluation loop

`machine.update(dt)` runs these steps, **in order**, every frame.

### 4.1 Step 1 — Input ingestion

1. Snapshot inputs: freeze booleans/numbers for this frame (writes made from event
   callbacks during `update` land in the _next_ snapshot).
2. Advance number smoothing by `dt`.
3. Age triggers; expire those past `ttl`.
4. Apply **listener-driven** input mutations queued since the last frame (§7.2).
5. Apply external `setInput` calls made since the last frame (already in the snapshot
   if made before `update`; documented as such).

### 4.2 Step 2 — Time advance

Per layer, advance the **active state's** local time by `dt × speed` (speed may be bound
to an input), handling loop / ping-pong / once. If a transition is in flight, advance
both the **from** and **to** states (the `from` state keeps playing during the fade
unless `freezeFrom: true`).

Timeline **markers** crossed this frame (using previous and new normalized time,
correct across loop wrap) are collected as pending events — **emitted at the end** of
the frame, not here (§4.7).

### 4.3 Step 3 — Transition resolution (per layer, priority order)

For each layer, find the transition that fires:

1. Candidate set, **in this order**:
   1. **Any State** transitions (global interrupts), in declaration order.
   2. Transitions from the **current state** (or from the _to_ state if mid-transition
      and interruption policy allows, §6), in declaration order.
   3. The Entry transition if the layer has just started.
2. A candidate is **eligible** iff:
   - its `from` matches (or is `any`), and it is not a self-transition unless
     `allowSelf: true`;
   - **Exit Time** is satisfied (§5.2);
   - its **condition tree** evaluates true (§5.1) against the frame snapshot.
3. The **first eligible** wins. Authors control precedence by ordering; Any State
   always out-ranks normal edges. `priority` on a transition (default 0) can reorder
   within its group (higher first).
4. On a win: **consume** every `trigger` referenced by the winning transition's
   conditions; start the crossfade (§6); queue `onExit` (from) / `onEnter` (to).
5. If none fires, nothing changes. Never evaluate more than **one** new transition per
   layer per frame, but allow a **zero-duration chain** of up to `maxChainDepth`
   (default 4) when a transition has `duration: 0` and lands on a state whose own
   transition is already eligible — bounded so author loops cannot hang a frame; hitting
   the cap reports a definition warning.

### 4.4 Step 4 — State & blend sampling

For each layer, produce a **layer sample** (sparse bones + sparse morphs):

- **Clip state:** sample clip at `time`; sample morph curve at the same time.
- **1D / 2D blend space:** compute barycentric/inverse-distance weights from the bound
  inputs, sample the contributing children, combine (§8.2). Children's _normalized_
  times are synchronised to a leader (§8.2) so footsteps stay aligned.
- **Direct blend:** evaluate each entry independently (§8.3).
- **Crossfade in flight:** `layerSample = blend(fromSample, toSample, ease(t/duration))`
  using the transition's easing (§6.1).

### 4.5 Step 5 — Layer & mask compositing

Start from the **base pose**: bind pose + morph defaults. For each layer in priority
order, apply it into the accumulator per channel with the mode, `layer.weight` and the
resolved mask weight from §3. Skip layers with zero effective weight.

### 4.6 Step 6 — Final output

1. Clamp morph weights to their range.
2. Normalise all output quaternions.
3. Publish a **`MachineOutput`**: `pose` (sparse list of changed bones — plus a dirty
   flag — or the full skeleton), `morphs` (sparse map), and `rootMotion` delta if the
   active states declare root motion.
4. The output is **read-only and reused** across frames (no per-frame allocation); the
   adapter copies it into the render objects.

### 4.7 Step 7 — Event dispatch

After the output is complete, drain the event queue in deterministic order: per layer
priority → `onExit`, `onEnter`, markers (timeline order), `onTransitionComplete`.
Callbacks run **after** state is consistent; any `setInput` inside a callback applies
next frame. Dispatch is synchronous; a throwing listener is isolated and reported, it
does not abort other listeners or the frame.

## 5. States, nodes and conditions

### 5.1 Condition evaluation

```text
Condition = Comparison | Group
Comparison = { input: string, op: Op, value?: number | boolean }
Group      = { all: Condition[] } | { any: Condition[] } | { not: Condition }
Op         = "equals" | "notEquals" | "greaterThan" | "lessThan"
           | "greaterOrEqual" | "lessOrEqual"       // convenience
           | "fired"                                // trigger only
```

- `all` = AND, `any` = OR; groups nest arbitrarily; an omitted condition is `true`.
- **Type-checked at load:** `boolean` supports `equals`/`notEquals` only; `trigger`
  supports only `fired`; `number` supports comparisons. Mismatch fails validation.
- Number equality uses an `epsilon` (`1e-6`) tolerance.
- Optional **hysteresis** on a comparison (`hysteresis: 0.05`) prevents flapping at a
  threshold: it must cross `value ± hysteresis` to flip back.

### 5.2 Exit time

- `exitTime`: normalized `0..1` of the **from state's** loop-local progress. The
  transition becomes eligible once `progress ≥ exitTime`.
- With `exitTime` set and **no** other conditions, it fires when the time is reached
  (auto-advance). With both, **both** must hold.
- `exitTime` applies to the current loop iteration; looping states report
  `progress = time mod duration / duration` so a clip can still "finish" once per loop.
  `exitTimeMode: "firstLoopOnly" | "everyLoop"` (default `everyLoop`).
- Blend spaces use the **leader** child's progress.

### 5.3 State kinds

**Clip state** — plays one skeletal clip and/or one morph curve:

| Field               | Meaning                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clip`/`morphCurve` | Asset ids; either or both.                                                                                                                                                 |
| `speed`             | Constant or `{ input, scale, offset }`.                                                                                                                                    |
| `loop`              | `once` \| `loop` \| `pingPong` \| `clampForever`.                                                                                                                          |
| `scrub`             | Optional `{ input, range:[inMin,inMax] }` — time is **driven by a number** (normalized by `range`) instead of advancing; speed ignored. Perfect for `aimPitch` ↔ aim clip. |
| `startAt`           | Normalized start time (or `random`).                                                                                                                                       |
| `additiveRef`       | For additive layers (§3.2).                                                                                                                                                |
| `markers`           | Derived from the clip's authored markers (plus optional definition overrides).                                                                                             |
| `rootMotion`        | `none` \| `extract` \| `apply`.                                                                                                                                            |

**Blend states** — 1D, 2D and Direct (§8).

**Routing nodes:**

- **Entry** — one per layer, has exactly one outgoing transition (conditional entries
  permitted; the first eligible wins, with a mandatory unconditional fallback).
- **Exit** — reaching it ends the layer's graph: `onLayerComplete` fires and the layer
  either `hold`s its last pose, `fadeOut`s to weight 0, or `restart`s (per `onExit`).
- **Any State** — not a real state. Its outgoing transitions are tested every frame
  from every state (except those flagged `excludeFrom`). Typical: `hit`, `death`.

## 6. Transitions, crossfading and interruption

### 6.1 Crossfade

```text
Fade = { duration: seconds, easing: Easing, mode: "fixed" | "normalized" }
Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "smoothstep"
       | { cubicBezier: [x1,y1,x2,y2] } | { curve: assetId }
```

- `fixed`: duration in seconds. `normalized`: fraction of the _from_ clip's duration.
- `t = clamp(elapsed / duration)`; blend factor `f = easing(t)`.
- **Skeleton:** per-bone `quat = nlerp(from, to, f)` (or `slerp`), translation/scale
  `lerp`. **Morphs:** `lerp(fromWeight, toWeight, f)`.
- A morph **channel present in only one side** blends against that channel's default
  (so a face-only clip fades in/out cleanly rather than popping).
- `duration: 0` is an instant cut.
- **Fade synchronisation** options: `syncTime` (start `to` at the same normalized time
  as `from`, for walk→run) or `startAt` on the target state.

### 6.2 Interruption behaviour

What happens when a transition becomes eligible **while another is in flight**:

| Policy                                 | Behaviour                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignore`                               | New transitions are not evaluated until the current one completes (default for the in-flight transition itself).                                                                              |
| `interrupt` (a.k.a. `fromCurrentPose`) | Snapshot the **currently blended output** of this layer as a frozen "source pose" and start a new fade from it. No pop, but the frozen pose stops advancing for the duration of the new fade. |
| `interruptKeepPlaying`                 | Like `interrupt` but the former blend keeps advancing as a live source (more expensive, smoother for locomotion).                                                                             |
| `queue`                                | Remember the winner (max depth 1, last-wins); start it the frame the current transition completes.                                                                                            |

- Policy is declared **on the in-flight transition** (`interruption`) and may be
  overridden by a layer default. **Any State** transitions may declare
  `forceInterrupt: true` to override `ignore` (death must never wait).
- Interrupting also **cancels** the pending `onTransitionComplete` for the old one
  (`onTransitionCancelled` fires instead) and runs `onExit` of the abandoned _to_
  state only if `onEnter` had already been delivered.
- A queued transition re-checks its conditions at dequeue time; if no longer valid it is
  dropped (reported), unless it is `queue: "force"`.

### 6.3 Transition record

Each active transition tracks `{ from, to, elapsed, duration, easing, source: live|frozen,
policy }`. Exposed read-only through `getActiveTransition(layer)`.

## 7. Events and 3D listeners

### 7.1 State and timeline events

| Event                 | Emitted when                                                        | Payload                               |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `stateEnter`          | A state becomes the target of a transition (at transition start)    | `{ layer, state, from }`              |
| `stateExit`           | A state stops being active (at transition **end**, or on interrupt) | `{ layer, state, to }`                |
| `transitionComplete`  | Fade reaches `t = 1`                                                | `{ layer, from, to, duration }`       |
| `transitionCancelled` | In-flight transition interrupted                                    | `{ layer, from, to, progress }`       |
| `layerComplete`       | Layer reaches Exit                                                  | `{ layer }`                           |
| `marker`              | Playhead crosses a named timeline marker                            | `{ layer, state, name, time, data? }` |
| `triggerExpired`      | Pending pulse timed out unconsumed                                  | `{ input }`                           |
| `warning` / `error`   | Validation, chain cap, unknown asset, listener exceptions           | `{ code, message, path }`             |

- Markers carry optional `data` (`{ foot: "left" }`) so one `footstep` marker serves
  both feet. During a crossfade, markers fire from **both** sides, with `weight` in the
  payload so consumers can ignore the fading-out side (`minWeight` filter on subscribe).
- Markers crossed by a **scrub** (input-driven time) fire only when `scrubEvents: true`
  (default false — scrubbing backwards or jittering would spam them).

### 7.2 3D mesh listeners (Rive listener equivalent)

Declarative bindings from **pointer interactions on a 3D target** to **input mutations**
— no application glue.

```text
Listener = {
  target:  { mesh: MeshId, submesh?: number, collider?: ColliderId, tag?: string }
  event:   "pointerEnter" | "pointerLeave" | "pointerDown" | "pointerUp"
         | "click" | "doubleClick" | "dragStart" | "drag" | "dragEnd"
  actions: Action[]
  filter?: { button?: 0|1|2, modifiers?: [...], minDragDistance?: number }
}
Action = { set: input, to: number | boolean }          // number/boolean
       | { fire: input }                               // trigger
       | { toggle: input }                             // boolean
       | { add: input, amount: number }                // number, clamped
       | { setFromDrag: input, axis: "x"|"y"|"u"|"v"|"distance", map: [inMin,inMax,outMin,outMax] }
```

- The machine **does not own raycasting.** The host forwards normalised pointer events
  (`machine.pointer(event)`) or registers an _event source_. The machine resolves which
  declared target the hit belongs to (including sub-mesh index and the hit **UV**).
- `setFromDrag` is the escape hatch for continuous control — e.g. dragging on a face
  mesh to drive `jawOpen`, or a 2D pad's `valence`/`arousal` from the hit UV.
- **Hover** pairs: `pointerLeave` is guaranteed whenever `pointerEnter` was delivered
  (also on blur/disable/destroy), so a hover flag cannot stick.
- **Capture:** `dragStart` captures the target until `dragEnd`, even if the pointer
  leaves the mesh.
- Listener actions are queued and applied at the **start of the next frame's input
  ingestion** (§4.1 step 4), keeping the evaluation deterministic.
- Listeners can be toggled at runtime (`setListenersEnabled(false)`), e.g. while a
  cutscene plays.

## 8. Blend nodes

### 8.1 Common behaviour

- Children reference clips/morph curves and a **position** in blend-space coordinates.
- All children are time-**synchronised** by normalised time to a `leader` child
  (default: highest weight, ties broken by declaration order) to keep gait cycles
  aligned. `syncTime: false` plays children independently.
- Weights always sum to 1 for pose blending; bones touched by only some children
  blend only among those that touch them.

### 8.2 1D and 2D blend spaces

**1D** — one input `x`. Children at sorted positions `p0 < p1 < …`. Clamp outside the
range; linearly interpolate between the two neighbours. (`idle@0, walk@1.5, run@4`.)

**2D** — inputs `x`, `y`. Algorithm selectable per node:

| Algorithm             | Use                                                      |
| --------------------- | -------------------------------------------------------- |
| `simpleDirectional`   | Directional locomotion, at most one child per direction. |
| `freeformDirectional` | Many children on a circle plus centre idle.              |
| `freeformCartesian`   | Arbitrary points (expression pad: valence × arousal).    |
| `triangulated`        | Delaunay barycentric — deterministic, no overshoot.      |

- Inputs outside the hull are **projected to the nearest edge/point** (no extrapolation).
- Optional input **normalisation ranges** per axis so heterogeneous units (`m/s`,
  `radians`) compare fairly.
- A child may contribute a **skeleton clip, a morph curve, or both**, so one 2D node
  can drive a facial pad (morphs only) while another drives legs (bones only).
- Node-level `scrub` is supported in 2D (time driven by input) for pose-pad usage.

### 8.3 Direct morph/pose blend node

Maps **N inputs → N independent targets**, not interpolation between neighbours.

```text
DirectEntry = {
  input:  string                        // number input
  curve?: Easing | { points: [[x,y]...] } // response curve, default linear
  range?: [inMin, inMax]                 // default input range → [0,1]
  target: { morph: { mesh, target } }    // sets that target's weight
        | { pose: assetId }              // blends an additive pose clip (frame 0) by weight
        | { morphGroup: string }         // scale an entire group
  gain?: number, offset?: number
}
```

- Entries are independent and **additive by construction** within the node; two entries
  on the same target **sum** (clamped later) unless `combine: "max" | "multiply"`.
- Used for procedural facial rigs (`jawOpen`, `smile`, `blinkL`, `blinkR`) and damage
  states (`damageLevel` → corrective shapes + a decal pose).
- Because it has no time axis, `exitTime` is meaningless on it (validation rejects it).

## 9. Declarative state machine schema (TypeScript-style)

```ts
// ── Root ────────────────────────────────────────────────────────────────
interface MachineDefinition {
  schemaVersion: 1;
  name: string;
  options?: MachineOptions;
  inputs: InputDef[];
  groups?: { morph?: Record<string, MorphRef[]>; bones?: Record<string, string[]> };
  masks?: Record<string, MaskDef>;
  layers: LayerDef[];
  listeners?: ListenerDef[];
}

interface MachineOptions {
  rotationBlend?: "nlerp" | "slerp"; // default "nlerp"
  morphRange?: [number, number]; // default [0, 1]
  maxChainDepth?: number; // default 4
  epsilon?: number; // default 1e-4
  defaultInterruption?: InterruptionPolicy; // default "ignore"
}

// ── Inputs ──────────────────────────────────────────────────────────────
type InputDef = NumberInputDef | BooleanInputDef | TriggerInputDef;

interface NumberInputDef {
  name: string;
  kind: "number";
  default: number;
  min?: number;
  max?: number;
  smoothTime?: number;
}
interface BooleanInputDef {
  name: string;
  kind: "boolean";
  default: boolean;
}
interface TriggerInputDef {
  name: string;
  kind: "trigger";
  ttl?: number;
  shared?: boolean;
}

// ── Masks ───────────────────────────────────────────────────────────────
interface MaskDef {
  extends?: string[];
  subtract?: string[];
  bones?: { root: string; includeDescendants?: boolean; weight?: number }[];
  morphs?: { mesh?: string; group?: string; targets?: string[]; weight?: number }[];
  default?: { bones?: 0 | 1; morphs?: 0 | 1 };
}
interface MorphRef {
  mesh: string;
  target: string;
}

// ── Layers ──────────────────────────────────────────────────────────────
interface LayerDef {
  id: string;
  priority: number;
  blend: "override" | "additive";
  weight: number | { input: string; scale?: number };
  mask?: string | MaskDef;
  entry: EntryDef[]; // ≥1, last one unconditional
  states: StateDef[];
  anyState?: TransitionDef[]; // `from` implied
  transitions: TransitionDef[];
  interruption?: InterruptionPolicy;
  onExit?: "hold" | "fadeOut" | "restart";
}

interface EntryDef {
  to: string;
  when?: Condition;
}

// ── States ──────────────────────────────────────────────────────────────
type StateDef = ClipState | Blend1DState | Blend2DState | DirectState | ExitState;

interface StateBase {
  id: string;
  tags?: string[];
  rootMotion?: "none" | "extract" | "apply";
}

interface ClipState extends StateBase {
  type: "clip";
  clip?: string;
  morphCurve?: string;
  speed?: number | { input: string; scale?: number; offset?: number };
  loop?: "once" | "loop" | "pingPong" | "clampForever";
  scrub?: { input: string; range: [number, number] };
  startAt?: number | "random";
  additiveRef?: "bindPose" | { clip: string; time: number };
  markers?: MarkerDef[];
}

interface BlendChild {
  clip?: string;
  morphCurve?: string;
  position: number | [number, number];
  speed?: number;
  timeScale?: number;
}

interface Blend1DState extends StateBase {
  type: "blend1d";
  input: string;
  children: BlendChild[];
  syncTime?: boolean;
  leader?: number;
  additiveRef?: ClipState["additiveRef"];
}
interface Blend2DState extends StateBase {
  type: "blend2d";
  inputX: string;
  inputY: string;
  children: BlendChild[];
  algorithm?: "simpleDirectional" | "freeformDirectional" | "freeformCartesian" | "triangulated";
  normalize?: { x?: [number, number]; y?: [number, number] };
  syncTime?: boolean;
  leader?: number;
  additiveRef?: ClipState["additiveRef"];
}
interface DirectState extends StateBase {
  type: "direct";
  entries: DirectEntry[];
  combine?: "sum" | "max" | "multiply";
}
interface ExitState {
  id: string;
  type: "exit";
}

interface DirectEntry {
  input: string;
  range?: [number, number];
  curve?: Easing | { points: [number, number][] };
  gain?: number;
  offset?: number;
  target: { morph: MorphRef } | { morphGroup: string } | { pose: string };
}

interface MarkerDef {
  name: string;
  time: number /* normalised */;
  data?: Record<string, unknown>;
}

// ── Transitions ─────────────────────────────────────────────────────────
interface TransitionDef {
  id?: string;
  from: string | "*"; // "*" = any (when not in anyState[])
  to: string;
  when?: Condition;
  exitTime?: number; // 0..1
  exitTimeMode?: "everyLoop" | "firstLoopOnly";
  fade?: { duration: number; easing?: Easing; mode?: "fixed" | "normalized"; syncTime?: boolean };
  interruption?: InterruptionPolicy;
  forceInterrupt?: boolean;
  allowSelf?: boolean;
  priority?: number;
  excludeFrom?: string[];
  freezeFrom?: boolean;
}

type InterruptionPolicy = "ignore" | "interrupt" | "interruptKeepPlaying" | "queue";

type Condition =
  | {
      input: string;
      op: "equals" | "notEquals" | "greaterThan" | "lessThan" | "greaterOrEqual" | "lessOrEqual";
      value: number | boolean;
      hysteresis?: number;
    }
  | { input: string; op: "fired" }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "smoothstep"
  | { cubicBezier: [number, number, number, number] }
  | { curve: string };

// ── Listeners ───────────────────────────────────────────────────────────
interface ListenerDef {
  id?: string;
  target: { mesh: string; submesh?: number; collider?: string; tag?: string };
  event:
    | "pointerEnter"
    | "pointerLeave"
    | "pointerDown"
    | "pointerUp"
    | "click"
    | "doubleClick"
    | "dragStart"
    | "drag"
    | "dragEnd";
  filter?: { button?: 0 | 1 | 2; minDragDistance?: number };
  actions: ListenerAction[];
}
type ListenerAction =
  | { set: string; to: number | boolean }
  | { fire: string }
  | { toggle: string }
  | { add: string; amount: number }
  | {
      setFromDrag: string;
      axis: "x" | "y" | "u" | "v" | "distance";
      map: [number, number, number, number];
    };
```

### 9.1 Load-time validation (all errors name a JSON path)

- Unique ids (inputs, layers, states per layer, masks); every reference resolves
  (`input`, `to`, `from`, `mask`, `group`, asset ids via a provided resolver).
- Condition ↔ input **type match** (§5.1); `trigger` only with `fired`.
- Every layer has a reachable path from Entry; unreachable states are **warnings**;
  a state with no outgoing path that is not terminal is a warning.
- **Cycle check on zero-duration, unconditional edges** (guaranteed infinite loop) is an
  **error**.
- `additive` layers: every state has an `additiveRef` (or an inherited default).
- `exitTime` rejected on `direct` states; `scrub` requires a `number` input and a clip.
- Number ranges consistent (`min ≤ default ≤ max`); blend children sorted/unique for 1D;
  ≥3 non-collinear points for `triangulated`.
- Masks acyclic in `extends`/`subtract`.
- Unknown bone / morph names (checked against the _rig description_ when supplied) are
  errors; without a rig description they are deferred to bind time.

### 9.2 Example (condensed)

```jsonc
{
  "schemaVersion": 1,
  "name": "hero",
  "inputs": [
    { "name": "moveSpeed", "kind": "number", "default": 0, "min": 0, "max": 6, "smoothTime": 0.1 },
    { "name": "isGrounded", "kind": "boolean", "default": true },
    { "name": "isAiming", "kind": "boolean", "default": false },
    { "name": "aimPitch", "kind": "number", "default": 0, "min": -1, "max": 1 },
    { "name": "jump", "kind": "trigger", "ttl": 0.15 },
    { "name": "flinch", "kind": "trigger" },
    { "name": "jawOpen", "kind": "number", "default": 0, "min": 0, "max": 1 },
  ],
  "masks": {
    "upperBody": {
      "bones": [{ "root": "spine_02", "includeDescendants": true }],
      "default": { "bones": 0, "morphs": 0 },
    },
  },
  "layers": [
    {
      "id": "locomotion",
      "priority": 0,
      "blend": "override",
      "weight": 1,
      "entry": [{ "to": "ground" }],
      "states": [
        {
          "id": "ground",
          "type": "blend1d",
          "input": "moveSpeed",
          "children": [
            { "clip": "idle", "position": 0 },
            { "clip": "walk", "position": 1.5 },
            { "clip": "run", "position": 4 },
          ],
        },
        { "id": "air", "type": "clip", "clip": "fall", "loop": "loop" },
        { "id": "jumping", "type": "clip", "clip": "jump", "loop": "once" },
      ],
      "transitions": [
        {
          "from": "ground",
          "to": "jumping",
          "when": { "input": "jump", "op": "fired" },
          "fade": { "duration": 0.1, "easing": "easeOut" },
        },
        { "from": "jumping", "to": "air", "exitTime": 0.9, "fade": { "duration": 0.15 } },
        {
          "from": "air",
          "to": "ground",
          "when": { "input": "isGrounded", "op": "equals", "value": true },
          "fade": { "duration": 0.2 },
        },
      ],
    },
    {
      "id": "aim",
      "priority": 1,
      "blend": "additive",
      "mask": "upperBody",
      "weight": { "input": "isAiming" },
      "entry": [{ "to": "aim" }],
      "states": [
        {
          "id": "aim",
          "type": "clip",
          "clip": "aim_additive",
          "loop": "clampForever",
          "scrub": { "input": "aimPitch", "range": [-1, 1] },
          "additiveRef": "bindPose",
        },
      ],
      "transitions": [],
    },
    {
      "id": "face",
      "priority": 2,
      "blend": "override",
      "weight": 1,
      "mask": { "morphs": [{ "group": "face.mouth" }], "default": { "bones": 0, "morphs": 0 } },
      "entry": [{ "to": "talk" }],
      "states": [
        {
          "id": "talk",
          "type": "direct",
          "entries": [
            { "input": "jawOpen", "target": { "morph": { "mesh": "head", "target": "jawOpen" } } },
          ],
        },
      ],
      "transitions": [],
    },
  ],
}
```

## 10. Programmatic control API

Consumer-facing and renderer-agnostic. Everything below is the **entire** public
surface; nothing exposes clips, bones or morph indices.

```ts
// ── Loading ─────────────────────────────────────────────────────────────
function createMachine(
  definition: MachineDefinition | unknown, // validated; throws MachineDefinitionError
  deps: {
    assets: AssetResolver; // id → clip/morph-curve data
    rig?: RigDescription; // optional bone/morph names for strict validation
    clock?: never; // time is always passed in via update()
  },
  options?: Partial<MachineOptions>,
): Machine;

function validateDefinition(def: unknown, rig?: RigDescription): ValidationReport;

// ── Instance ────────────────────────────────────────────────────────────
interface Machine {
  // Evaluation
  update(dt: number): MachineOutput; // runs §4 in full
  readonly output: MachineOutput; // last result (read-only, reused)
  reset(options?: { keepInputs?: boolean }): void;
  dispose(): void;

  // Inputs (the black-box contract)
  setNumber(name: string, value: number): void;
  setBoolean(name: string, value: boolean): void;
  fire(name: string): void; // trigger
  getNumber(name: string): number; // raw target value
  getSmoothedNumber(name: string): number;
  getBoolean(name: string): boolean;
  isTriggerPending(name: string): boolean;
  readonly inputs: ReadonlyMap<string, InputInfo>; // names, kinds, ranges — for tooling/UI

  // Introspection (read-only)
  getActiveState(layer: string): StateInfo; // { id, tags, time, normalizedTime, speed }
  getActiveTransition(layer: string): TransitionInfo | null;
  getLayerWeight(layer: string): number;
  isInState(layer: string, state: string): boolean;
  hasTag(layer: string, tag: string): boolean; // "is the character in any 'airborne' state?"

  // Layer control (runtime overrides of declared defaults)
  setLayerWeight(layer: string, weight: number): void; // overrides weightInput until cleared
  setLayerEnabled(layer: string, enabled: boolean): void;

  // Events
  on<K extends keyof MachineEvents>(
    event: K,
    handler: (e: MachineEvents[K]) => void,
    opts?: { layer?: string; state?: string; name?: string; minWeight?: number },
  ): Unsubscribe;
  once<K extends keyof MachineEvents>(
    event: K,
    handler: (e: MachineEvents[K]) => void,
    opts?: SubscribeFilter,
  ): Unsubscribe;

  // 3D listeners
  pointer(event: PointerHit): void; // host forwards normalised hits
  setListenersEnabled(enabled: boolean): void;
}

type Unsubscribe = () => void;

interface MachineEvents {
  stateEnter: { layer: string; state: string; from: string | null };
  stateExit: { layer: string; state: string; to: string | null };
  transitionComplete: { layer: string; from: string; to: string; duration: number };
  transitionCancelled: { layer: string; from: string; to: string; progress: number };
  layerComplete: { layer: string };
  marker: {
    layer: string;
    state: string;
    name: string;
    time: number;
    weight: number;
    data?: Record<string, unknown>;
  };
  triggerExpired: { input: string };
  warning: { code: string; message: string; path?: string };
  error: { code: string; message: string; cause?: unknown };
}

// ── Output (the adapter's only input) ───────────────────────────────────
interface MachineOutput {
  readonly bones: ReadonlyMap<string, BoneTransform>; // local-space, only touched bones
  readonly morphs: ReadonlyMap<string, number>; // key = `${mesh}:${target}`, clamped
  readonly rootMotion: { dPosition: Vec3; dRotation: Quat } | null;
  readonly dirty: { bones: boolean; morphs: boolean };
}

interface PointerHit {
  type: PointerEventType;
  mesh: string;
  submesh?: number;
  collider?: string;
  uv?: [number, number];
  point?: Vec3;
  button?: number;
  pointerId: number;
}
```

### 10.1 Usage sketch

```ts
const machine = createMachine(heroDefinition, { assets });

machine.on("marker", (e) => audio.play(e.data?.foot === "left" ? "stepL" : "stepR"), {
  name: "footstep",
  minWeight: 0.5,
});
machine.on("stateEnter", () => haptics.light(), { layer: "locomotion", state: "jumping" });

// game loop
machine.setNumber("moveSpeed", velocity.length());
machine.setBoolean("isGrounded", body.onGround);
if (input.jumpPressed) machine.fire("jump");
const out = machine.update(dt); // → apply to skeleton/mesh via adapter
```

### 10.2 API guarantees

- **Idempotent writes:** setting the same value is cheap and does not re-trigger anything.
- **Order independence within a frame:** calls to `setNumber`/`setBoolean`/`fire`
  before `update` can occur in any order; the result is identical.
- **No hidden clocks:** all time flows through `update(dt)`. `dt` is clamped to
  `maxDt` (default `0.1 s`) so a tab pause does not teleport animation.
- **Re-entrancy:** calling `update` from an event handler throws; setting inputs from a
  handler is allowed and takes effect next frame.
- **Safe in tests:** with a stub `AssetResolver` (durations + markers only), the machine
  runs headlessly — states, transitions, events and input behaviour are testable
  without a renderer, skeleton or WebGL.

## 11. Edge cases and decisions

| Case                                             | Decision                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Trigger fired while no transition can consume it | Stays pending until `ttl`, then `triggerExpired`. Prevents "lost jump", avoids "ghost jump".                             |
| Two layers want the same non-shared trigger      | Lowest `priority` number layer wins; the other never sees it.                                                            |
| Any State and normal edge both eligible          | Any State wins; reorder with `priority`.                                                                                 |
| Transition target equals current state           | Ignored unless `allowSelf` (restart).                                                                                    |
| Clip shorter than fade                           | Fade clamped to `min(duration, clipDuration)` for `once` clips and warned at load.                                       |
| Additive layer with weight 0                     | Skipped entirely (no ref pose computation).                                                                              |
| Mask excludes a channel the state writes         | Channel ignored; state still plays and still emits markers.                                                              |
| Marker time exactly at loop boundary             | Fires once per loop (half-open interval `(prev, now]`).                                                                  |
| Large `dt` crossing multiple markers/loops       | All markers fire in order; at most one transition resolves per frame.                                                    |
| Entry has no eligible transition                 | Definition error (unconditional fallback is mandatory).                                                                  |
| Listener target not hit-testable                 | Warning at load if mesh unknown to `rig`; silently idle otherwise.                                                       |
| Hot-reloading a definition                       | `machine.reload(def)` keeps inputs and active state ids where they still exist, else falls to Entry. _(Open — see §12.)_ |

## 12. Open questions (to decide before implementation planning)

1. **Root motion** — in scope for v1 or deferred? It shapes `MachineOutput`.
2. **Retargeting** — does the machine see canonical bone names only, or does the adapter
   own name mapping? (Spec assumes canonical names.)
3. **Hot reload** — preserve runtime state across definition edits? (Matters for an
   authoring tool; costs a state-migration story.)
4. **Sub-state-machines / nested graphs** — not in this spec; would nest a layer inside
   a state. Worth reserving the `type` discriminant for.
5. **Serialization of runtime state** (save games, network sync) — the pure-function
   design makes it feasible: `{ inputs, per-layer state id + time + transition }`.
6. **Determinism across platforms** — floating-point order of blend accumulation must be
   fixed if replays/networking matter.
7. **Listener ownership of raycasting** — host-forwarded hits (current choice) vs a
   built-in raycaster adapter. Host-forwarded keeps the core free of any renderer.
8. **Binding to the existing app** — if adopted here, the evaluator belongs in `core/`
   (pure TS, no three/R3F/zustand), with the pose/morph application and pointer
   forwarding as `infrastructure/` and `presentation/canvas/` adapters, honouring the
   existing inward-only import rule. Interaction with Theatre.js sheets (which today own
   transform tracks) needs an explicit ownership rule per prop, as with `/float`.
