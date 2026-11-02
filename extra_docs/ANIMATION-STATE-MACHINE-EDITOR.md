# Animation & Mesh State Machine — Editor UI/UX Specification

Status: **specification, partially implemented.** The workspace exists at `/editor?editor`
(dev builds only) — see "Implementation status" below for the delta between this document and
the code.

- Source brief, verbatim: `extra_docs/STATE-MACHINE-UI-PROMPT.md`.
- Runtime counterpart: `extra_docs/ANIMATION-STATE-MACHINE.md` (schema, evaluation loop, API).
- This document is the UI/UX layer: what each panel shows, what it exposes, and how the four
  zones stay in sync. It describes the editor as a first-class tool in this suite rather than
  a debug page.

Read this with three facts in hand, because they shape almost every decision below:

1. **The runtime already exists** (`src/core/usecases/animationStateMachine/`, 8.8k lines,
   `vp check` clean, 294 tests). The editor is a _view over that contract_, not a second
   engine.
2. **The runtime's public API is missing pieces the editor needs** — `hasTag`,
   `getActiveTransition`, `getSmoothedNumber`, `isTriggerPending`, `once(..., filter)`,
   `transitionComplete`. §14 lists them as a prerequisite; wiring the UI against today's
   `Machine` interface would mean reading internals.
3. **Theatre Studio already owns keyframe authoring and the two `states/*.json` files.**
   §7.4 draws the line: the timeline pane may _read_ Theatre tracks and _write_ machine
   markers, and must not become a second writer of Theatre state. Two writers over one
   file is the failure mode already documented for the Studio's Save button.

---

## Implementation status

What exists now, and where it lives:

| Spec area                                                             | State                                                                             | Code                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Four zones, header / sidebar / stage / inspector                      | done                                                                              | `src/presentation/ui/editor/App.tsx`                                                  |
| Graph: deterministic rank layout, drag, wheel zoom, pan               | done                                                                              | `editor/graph/GraphCanvas.tsx`, `core/usecases/animationStateMachine/editorLayout.ts` |
| Port-drag to author a transition; edge deck (condition, fade, easing) | done                                                                              | `GraphCanvas.tsx`, `editor/inspector/Inspector.tsx`                                   |
| Inspector decks: state, transition, layer, input, listener, markers   | done                                                                              | `Inspector.tsx`                                                                       |
| Sidebar: inputs, listeners, layers with solo/mute, filter             | done                                                                              | `editor/sidebar/Sidebar.tsx`                                                          |
| Selection ⇄ `?sel=` (one format everywhere)                           | done                                                                              | `editorSelection.ts`                                                                  |
| Undo/redo, dirty state, discard, `Cmd+S`, `Delete`, `Space`, `1/2/3`  | done                                                                              | `useEditorStore.ts`, `App.tsx`                                                        |
| Preview machine (step / pause, rebuild on structural change)          | done                                                                              | `editor/PreviewCanvas.tsx`, `structuralHash.ts`                                       |
| Save: definition + workspace file through a dev-only endpoint         | done                                                                              | `scripts/studio-save-plugin.ts` (`/__astro-editor/*`)                                 |
| Invalid drafts refused rather than rendered                           | done                                                                              | `useEditorStore.apply`, `addState` inheriting a clip reference                        |
| Mobile: inspector as a bottom sheet                                   | done                                                                              | `editor.css` `@media (max-width: 900px)`                                              |
| Stage modes (graph / timeline / split) as row ratios                  | done                                                                              | `editor.css` `.ed-stage[data-mode]`                                                   |
| **Dope sheet with keyframe editing**                                  | **not done** — Theatre owns keyframes; the strip shows markers and telemetry only | §7.4                                                                                  |
| **Marquee / multi-select / context menus / zoom-to-fit**              | not done                                                                          | §6.B–6.D                                                                              |
| **Structured condition builder** (only a leaf list + raw JSON today)  | partial                                                                           | `Inspector.tsx` `ConditionEditor`                                                     |
| **Comparison view, presence strip, minimap**                          | not done                                                                          | §10                                                                                   |

## 0. Scope and non-goals

**In scope:** the four-zone workspace; every panel's contents, controls, defaults and empty
states; the flows in the brief; the synchronization contract between panels, viewport and
evaluator; the editor-only data that has to be persisted; the ordering of the build.

**Not in scope:** the runtime schema (§11 of the runtime spec owns it), the Theatre keyframe
editor, asset import/pipeline (glTF loading, rigging), export to engines, multiplayer.

**A rule that governs the whole document.** Every panel is a view over one of exactly three
sources, and a panel never writes a source it does not own:

| Source                                           | Owner                 | Written by                                      | Read by                                  |
| ------------------------------------------------ | --------------------- | ----------------------------------------------- | ---------------------------------------- |
| `MachineDefinition` (draft)                      | `EditorDoc`           | inspector, graph, inputs panel, listeners panel | inspector, graph, runtime on rebuild     |
| Theatre `project state`                          | Theatre Studio's Save | Theatre Studio only                             | timeline pane (read), `theatreTracks.ts` |
| Editor UI state (layout, selection, debug flags) | `EditorUi`            | panels, graph, splitters                        | panels, graph                            |

The runtime `Machine` instance is a fourth thing, and it is **never** a source: it is a
consumer of the draft, and its output is telemetry.

---

## 1. Where the editor lives in the suite

**Route:** `/editor` → machine picker, `/editor/:machineId` → graph mode,
`/editor/:machineId/timeline/:clipId` → timeline mode. Selection is query state
(`?sel=state:locomotion/idle`), so a URL reproduces a workspace and a bug report can be a
link. Routes register unconditionally, per the house rule; the _editing_ is what is gated.

**Gating:** the editor is a **dev + desktop** tool, and says so instead of degrading:

- `import.meta.env.DEV` and `Capacitor.isNativePlatform() === false`, same rule as
  `initTheatreStudio()`. On a phone, `/editor` renders a one-paragraph page: "the machine
  editor needs a pointing device and ≥ 1024 px width — open `/machine` for the live tester".
- Under 1024 px width the shell collapses to a single column and shows the same notice,
  because a node graph with a 3D viewport at 390 px is not a shippable surface.

**Entry points** (all of them, because a tool nobody can find is not a tool):

1. `StudioDevButton` → new row "Machine editor".
2. Theatre Studio toolbar → an icon in the existing `astro.machine-tools` group that
   deep-links to `/editor/<machineId>?sel=timeline:<sheetId>`.
3. `/machine` → a small "edit" link in the header, and it opens the editor on the same
   machine so the debug page and the authoring page cannot drift apart.
4. Future `/lab` index card (not built; listed so the route shape stays stable).

**Machines are per scene, and a scene may have as many as the animator wants.** A scene
owns N independent machines; each machine owns 1..M layers. The Astro example from the
brief is _one_ machine with three layers or, equally valid, one machine with three states —
that is an authoring decision, not a schema one — and a second machine ("Face/Blink") can
run beside it without either knowing the other exists.

```text
src/infrastructure/theatre/animationStateMachine/scenes/
  AstroScene/
    astro.machine.json            ← MachineDefinition   (Idle / Sleeping / Blink, 1..M layers)
    astro.machine.editor.json     ← layout + debug      (§4.4)
    astro-face.machine.json       ← a second, independent machine for the same scene
    astro-face.machine.editor.json
  FloatScene/
    float.machine.json
    float.machine.editor.json
```

- `MachineDefinition` gains one field the runtime ignores: `scene: string` (the `SceneId` its
  clips are resolved against). It is what the picker groups by, and it lets a machine be
  copied between scenes with a validation error rather than clips that resolve to nothing.
- **Machines in one scene run independently**, each with its own `Machine` instance, its own
  inputs and its own playhead; the app may step one, some, or all of them. Nothing in the
  runtime changes for this — it was always one `Machine` per definition. The _editor_ only
  ever edits one at a time and the viewport shows the one being edited (a "run all" toggle is
  listed as a debug affordance, not a requirement).
- `machineDefinitionStore` gains `listMachines(scene)` and `saveMachine(id, definition)`;
  the editor's Save writes `<id>.machine.json` and never touches the editor file. The editor
  file is written on layout change, debounced, and is git-ignored: node positions are a local
  comfort, and a merge conflict over `{x, y}` is not worth a review.

---

## 2. Workspace layout

Four zones, desktop-first, one splitter between each pair. The shell is CSS grid; sizes are
minimums, not fixed widths.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ HEADER  machinename ▾ · [Graph | Timeline] · ▶ Play · ■ Stop · Save · status   │ 48px
├──────────────────────────────────────────────────────────────────────────────┤
│                                          │                                   │
│   ZONE 1 — 3D VIEWPORT (top center)       │   ZONE 4 — INSPECTOR              │
│   min 320px tall, resizable               │   min 320 / max 420px wide        │
│   overlay: mode badge, gizmo, FPS          │   context-sensitive (§8)          │
│                                          │                                   │
├───────────────────┬──────────────────────┤                                   │
│ ZONE 2 — SIDEBAR   │ ZONE 3 — STAGE       │                                   │
│ min 240 / max 320  │ flex                 │                                   │
│ vertical scroll    │ graph | timeline     │                                   │
└───────────────────┴──────────────────────┴───────────────────────────────────┘
```

Behaviour rules:

- **Splitters** are draggable, remember their size in `EditorUi`, and clamp to the minimums
  above. Double-click a splitter resets it to the default (viewport 45 %, sidebar 280 px,
  inspector 340 px).
- **Zone 3 owns two modes**, and the header's `[Graph | Timeline]` segments switch them.
  `Split` is a third state: graph on the left 60 %, timeline on the right 40 %, both live,
  both scrolled independently. It exists because flow (c) is a round trip, and a round trip
  that costs a mode switch is a round trip nobody makes twice.
- **Full-screen stage** (`F`): zones 1/2/4 collapse to the header + stage, with the viewport
  becoming a floating 280×220 picture-in-picture in the corner. For wiring a 40-node graph
  on a laptop.
- **Focus is explicit**: exactly one zone has focus, drawn as a 1 px accent outline on its
  edge. Clicking a node focuses the stage, clicking a track focuses the timeline, clicking
  the viewport focuses nothing (orbit drags should not steal keyboard focus from the graph).
- **Keyboard**: `1`/`2`/`3` focus viewport / sidebar / stage, `F` fullscreen stage, `Esc`
  clears selection, `Space` play/pause (when the stage is not a text field), `Ctrl/Cmd+S`
  save, `Ctrl/Cmd+Z` / `Shift+Ctrl/Cmd+Z` undo/redo.

---

## 3. Component tree

Names are the React component names; `[store]` marks what a node reads.

```text
EditorPage                                  route shell, loads machine + editor files
└─ EditorGate                               width/DEV/native check, renders the notice
   └─ EditorShell                           grid, splitters, keyboard map
      ├─ EditorHeader
      │  ├─ MachinePicker          [doc, ui] which .machine.json
      │  ├─ ModeTabs               [ui]     graph | timeline | split
      │  ├─ TransportControls      [rt]     play, stop, step, speed (debug)
      │  ├─ SaveButton             [doc]    dirty dot, Ctrl+S
      │  └─ StatusBar              [doc]    validation count, last error, frame time
      ├─ ViewportZone
      │  ├─ MachineCanvas          [rt]     the existing canvas, one .machine.json at a time
      │  ├─ ViewportOverlay        [rt]     mode badge: MACHINE / PREVIEW <clip> / STOPPED
      │  ├─ CameraGizmo            [ui]
      │  └─ TelemetryHud           [rt]     fps, active layers, bone/morph write counts
      ├─ SidebarZone
      │  ├─ AssetPanel             §5.A
      │  ├─ InputPanel             §5.B
      │  └─ ListenerPanel          §5.C
      ├─ StageZone
      │  ├─ GraphMode              §6
      │  │  ├─ LayerTabBar         [doc, ui]
      │  │  ├─ GraphCanvas         [doc, ui] pan/zoom, marquee, keyboard
      │  │  │  ├─ NodeClipState    [doc]
      │  │  │  ├─ NodeBlend1d      [doc]
      │  │  │  ├─ NodeBlend2d      [doc]
      │  │  │  ├─ NodeDirect       [doc]
      │  │  │  ├─ NodeSystem       [doc]     entry | anyState | exit
      │  │  │  ├─ Noodle           [doc]
      │  │  │  └─ TelemetryRing    [rt]      one per node, see §6.D
      │  │  ├─ GraphToolbar        add state, auto-layout, zoom fit, grid
      │  │  └─ Minimap             [ui]
      │  └─ TimelineMode           §7   the *machine's* view of a clip, not a keyframe editor
      │     ├─ TimelineBreadcrumb  [doc, ui]
      │     ├─ ClipStrip           [doc]     name, speed, loop, duration, "open in Studio"
      │     ├─ MarkerStrip         [doc, ui] machine markers only (§7.C)
      │     └─ ClipManifest        [doc]     channels/key counts, read-only (§7.D)
      └─ InspectorZone
         └─ InspectorHost          [ui]     switches on selection kind
            ├─ InspectorClipState      §8.A
            ├─ InspectorBlend1d        §8.B
            ├─ InspectorBlend2d        §8.C
            ├─ InspectorDirect         §8.D
            ├─ InspectorTransition     §8.E
            ├─ InspectorLayer          §8.F
            ├─ InspectorTimeline       §8.G   (machine markers + clip info)
            └─ InspectorEmpty          "nothing selected" + shortcuts
```

**Selection model.** One selection, one kind:

```ts
type Selection =
  | { kind: "state"; layer: string; state: string }
  | { kind: "transition"; layer: string; from: string; to: string; index: number }
  | { kind: "layer"; layer: string }
  | { kind: "input"; name: string }
  | { kind: "listener"; index: number }
  | { kind: "timeline"; clipId: string }
  | null;
```

`index` exists because a layer may hold several transitions between the same pair
(`from`/`to` are not unique in `LayerDef.transitions`); the graph draws them fanned with a
numbered badge and the inspector edits the one whose index it was given.

---

## 4. State model

### 4.1 Three stores, no overlap

| Store             | Contents                                                                                                         | Lifetime         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| `useEditorDoc`    | `definition` draft, `dirty`, undo/redo stack, `validation` report, `machineId`                                   | per open machine |
| `useEditorUi`     | layout sizes, mode, `selection`, pan/zoom, hover, debug flags (solo/mute, play state, preview clip), filter text | per session      |
| `useMachineStore` | runtime telemetry only (extended, §4.3)                                                                          | per play session |

The machine instance itself stays in `useAnimationMachine`'s ref, never in a store — the
existing rule, and the reason the debug page did not melt.

### 4.2 Undo

- Scope: `definition` edits only. Not selection, not play state, not layout, not debug flags.
- Granularity: a _command_ per user gesture. Dragging a threshold slider to 3.4 is one
  command (commit on pointerup), not 40. Conditions built row-by-row are one command per
  row.
- Stack: 100 commands, snapshots of the definition (it is small JSON; a 2k-line definition
  is ~60 KB and 100 snapshots is 6 MB — acceptable, and simpler than inverse patches).
- Undo while playing: the machine rebuilds after the undo (see §4.5), and the header shows
  "rebuilt" once.

### 4.3 Telemetry channel

The runtime step loop publishes into `useMachineStore` **once per animation frame**, not
once per machine frame, and nodes subscribe individually:

```ts
interface LayerTelemetry {
  layer: string;
  state: string;
  progress: number;            // normalized 0..1, rounded to 0.005
  speed: number;
  weights: Record<string, number>;   // per state, during a crossfade
  transition: { from: string; to: string; progress: number; kind: InterruptionPolicy } | null;
}

useMachineStore.telemetry: Record<string, LayerTelemetry>   // key = layer id
```

`TelemetryRing` uses `useSyncExternalStore` against a module-scope `subscribeTelemetry(layer)`
with an equality function that ignores deltas under 0.5 %. A 60 Hz write must not re-render
a node card; if it does, a 40-node graph is 2 400 renders a second and the editor is dead on
a laptop. The graph's own tree re-renders only when `definition` or `selection` changes.

### 4.4 Editor-only data (`*.editor.json`)

```jsonc
{
  "version": 1,
  "machineId": "hero",
  "layout": {
    "nodes": { "locomotion/idle": { "x": 120, "y": 80 } }, // key = "<layer>/<state>"
    "systemNodes": { "locomotion/__entry": { "x": 20, "y": 80 } },
    "zoom": 1,
    "pan": { "x": 0, "y": 0 },
  },
  "debug": { "solo": ["facial"], "mute": [], "selectedLayer": "locomotion" },
  "collapsed": { "timelines": false, "machines": true },
  "splits": { "viewport": 0.45, "sidebar": 280, "inspector": 340 },
}
```

Rule: **the runtime schema never grows a UI field.** A missing entry in `nodes` is not a
bug — the auto-layout (`GraphToolbar → Arrange`) computes a deterministic layered layout
from the transitions and writes the result back on demand. Determinism matters: the same
definition must land in the same place, or every review of a screenshot is guesswork.

### 4.5 Live editing while playing

Three cases, declared because guessing is how a machine silently resets:

| Edit                                                           | While stopped | While playing                                                                                  |
| -------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| numeric tuning (duration, exit time, threshold, weight, speed) | draft only    | applied hot where the runtime reads it per frame; otherwise rebuild                            |
| structural (states, transitions, layers, masks, inputs)        | draft only    | machine pauses, rebuilds from the draft, resumes at the current inputs, header shows "rebuilt" |
| Theatre keyframes (outside this editor)                        | —             | not observed; the runtime reads clips at construction, so a clip edit needs a rebuild          |

Implementation of "structural changed": a shallow structural hash over the definition minus
the numeric-tuning fields. A single flag, computed on save-of-command, rather than diffing
per keystroke.

---

## 5. Zone 2 — sidebar

Fixed vertical order: **Assets** (collapsible, default open), **Inputs** (open),
**Listeners** (collapsed). Each panel has a header with a count badge, a chevron, and one
`+` where adding is meaningful. Panels scroll independently; the sidebar as a whole scrolls
when collapsed panels make room insufficient.

### 5.A Animations & state machines selector

Three levels, all collapsible. A scene is the top level because that is what the animator
thinks in, and because the same clip name can exist in two scenes:

```
▾ SCENES
  ▾ AstroScene                                        [+ machine] [+ timeline]
      STATE MACHINES (2)
      ▌ astro          Idle · Sleeping · Blink         1 layer
      ▌ astro-face     Blink                          1 layer
      TIMELINES (9)
      ▌ AstroScene/Astro        8.0s  1.0×  3 tracks  ▶
      ▌ AstroScene/Blink        0.6s  1.0×  1 track   ▶
  ▸ FloatScene
```

- Row anatomy: type glyph (`machine` = branch, `timeline` = film), name, and for a timeline
  its duration, **its own speed multiplier** (read from the machine only when opened from a
  state, else 1.0×) and its track count; for a machine, the state names it can reach and its
  layer count. Hover reveals `▶`.
- Machines with the same `scene` are siblings, not layers of each other: selecting one
  replaces the graph's contents and the viewport's machine instance (§1). A machine is never
  nested inside another machine's layer.
- **Click a timeline** → zone 3 switches to Timeline mode with that clip; the viewport enters
  `PREVIEW <clip>` and plays it (§9.c). **Click a machine** → graph mode; the viewport enters
  `MACHINE`.
- **`▶` inline** previews without changing the stage mode: the viewport plays the clip once,
  the badge reads `PREVIEW`, and releasing stops it. This is the "instant preview" from the
  brief and it is deliberately separate from selecting — browsing clips should not collapse
  a graph the user is wiring.
- The current row carries a 2 px accent left border; hover a 1 px one.
- Filter box appears when the list exceeds 12 rows.
- Empty state: "No timelines in the project state. Rig one on `/rig/<scene>` and press the
  Studio's Save." with a link — same wording as the Machine pane, because it is the same
  cause.

### 5.B Inputs (parameters)

The black-box contract **and** the live control deck. Rows are draggable to reorder (order is
`definition.inputs` order, and that order is what the inspector's dropdowns list).

```
INPUTS (4)                                         [+ ▾ Number Boolean Trigger]
⠿ speed        NUM   0.00  ▏▁▂▃▄▅▆▇█ 0–6   ◀●▶   [ … ]
⠿ grounded     BOOL  [ ● ]                                [ … ]
⠿ jump         TRG   ( ▶ )                  pending •
⠿ emotion      NUM   0.42  ▏▁▂▃▄▅▆▇█ 0–1   ◀●▶
```

Per kind, when the machine is running (and greyed when stopped):

| Kind    | Control                                                                          | Behaviour                                                                                                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Number  | value readout (2 dp, monospace) + **drag-scrub** field + optional min/max slider | drag ≥ 3 px begins a scrub; 1 px = 0.01 × (max−min or 2); `Shift` = ×0.1; `Alt` = ×10. Writes `setNumber` on every pointermove (**no debounce** — a blend pad that lags is worse than a chatty write). Slider shown only when `min`/`max` are declared. |
| Number  | ghost tick for the **smoothed** value                                            | the target is the dot, the smoothed value is a 1 px vertical line behind it; two values are the whole point of `smoothTime`                                                                                                                             |
| Boolean | switch                                                                           | writes `setBoolean` on change, `true` right, per platform convention                                                                                                                                                                                    |
| Trigger | momentary button with pulse glyph                                                | press fires once, flashes 120 ms, then shows a `pending` dot until the runtime consumes it (`isTriggerPending`), so a trigger that nobody reads is visible instead of mysterious                                                                        |

Row menu (`…`): Rename, Edit range (`min`/`max`/`default`/`smoothTime`), Delete, "Find
usages".

**Rename is a refactor, not a text edit.** It rewrites every `Condition`, `SpeedBinding`,
`ScrubBinding`, layer `weight.bind`, `DirectEntry.input`, constraint `ref` and listener action
that names it, as **one undoable command**, and refuses (with a list) when the new name
collides. A rename that leaves a dangling reference is exactly the silent failure the
validator was built to catch — do not let the UI produce it.

**Delete** shows the usage count in the confirmation; deleting a used input is allowed (the
validator will flag it) but the confirmation says which states will refuse to load.

### 5.C 3D listeners

```
LISTENERS (2)                                            [+ listener]
  Head   → click       → fire  "poke"
  Hand   → hover       → set number "reach" = 1.0
```

- Row anatomy: target chip (`mesh` or `bone`), event chip, action chip, `…`.
- `+ listener` opens an inline composer with three dropdowns: **Target** (meshes from
  `definition.groups.morph` meshes + rig bones + a `pick in viewport` mode), **Event**
  (`click`, `pointerDown`, `pointerUp`, `hover`, `pointerMove`, `drag`), **Action**
  (`fire <trigger>`, `set <number> = <value>`, `set <boolean> = <value>`).
- `pick in viewport` dims the viewport and highlights every registered mesh with an outline;
  clicking one fills the target and hints "add `blink` as a listener target" if the mesh has
  no morph group.
- Clicking a row selects it (`Selection.listener`) and the inspector shows the full
  composer (§8.H) — the row is the summary, the inspector is the form.
- Empty state: "No listeners. Add one to let a tap in the viewport move the machine without
  glue code."

---

## 6. Zone 3, mode A — the node graph

### 6.A Layer tab bar

```
[ Base Locomotion  OVR ] [ Upper Body  OVR ● ] [ Facial Morphs  ADD ◐ ]   ⚙
```

- One tab per `definition.layers`, ordered by **evaluation order** (priority descending —
  the order that actually wins conflicts, not the JSON array order).
- Each tab: name, blend badge (`OVR` / `ADD`), mask chip (filled when `mask` is set; click
  opens the mask editor in the inspector), `S` solo, `M` mute.
- Solo/mute are **debug flags** (`EditorUi`), not definition fields: muzzling a layer must
  not dirty the document. Setting a layer's weight to 0 in the inspector _is_ a definition
  edit, and the tab shows a dimmed state for both, with a tooltip that says which.
- `⚙` on the bar → "Add layer", "Duplicate layer", "Delete layer" (disabled at one layer;
  the runtime refuses empty `layers`), "Reorder" (drag tabs left/right = priority).
- Clicking a tab's body selects the layer (`Selection.layer`) and filters the canvas to it;
  `All` (a pseudo-tab at the left) shows every layer stacked with a 24 px gutter between
  bands, which is the only way to see a cross-layer `Any State` interrupt at a glance.

### 6.B Canvas and gestures

Infinite canvas, 8 px grid, dots at 64 px, snap-to-grid on by default (`G` toggles).

| Gesture                | Result                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| wheel / trackpad       | pan                                                                                                                                    |
| `Ctrl`+wheel           | zoom, anchored at the cursor, 0.25×–2×                                                                                                 |
| drag empty space       | marquee select (nodes only)                                                                                                            |
| `Space`+drag           | pan from anywhere                                                                                                                      |
| drag node header       | move node(s); commits one command on release                                                                                           |
| drag from output port  | starts a noodle; drop on a node body = transition to it; drop on empty space = "add state" menu filtered to targets, then creates both |
| click node             | select; `Shift`+click extends                                                                                                          |
| double-click clip node | open its timeline (§9.c)                                                                                                               |
| double-click empty     | "add state" menu at that point                                                                                                         |
| `Del` / `Backspace`    | delete selection; transitions are deleted immediately, states require confirmation naming their inbound/outbound counts                |
| `↑↓←→`                 | nudge selected 8 px (with the grid)                                                                                                    |
| `Esc`                  | cancel noodle drag, else clear selection                                                                                               |
| `F`                    | zoom to fit; `Shift+F` fits selection                                                                                                  |

Noodle routing: cubic Bézier, horizontal tangents, `out → in`. Parallel transitions between
the same pair are fanned ±14 px with a numbered badge (`2`, `3`) at the midpoint; clicking a
badge selects that exact index. A self-transition (from = to) is a loop above the node,
because `TransitionDef` permits it and the runtime treats it as a restart.

### 6.C Node anatomy

Common card: 8 px radius, `--editor-surface`, 1 px border (`--editor-line`), header 28 px
with the state name (inline-renameable), body 44–96 px, footer 6 px progress track. Ports
are 12 px circles inset on the left/right edges, 24 px hit radius, `aria-label`
"output: <state>" / "input: <state>".

| Node                   | Size        | Body shows                                                                                              | Footer            |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------- | ----------------- |
| **Entry** (system)     | 120×36 pill | `Entry`, green header                                                                                   | — (out port only) |
| **Any State** (system) | 140×36 pill | `Any State`, teal header, `∞` glyph                                                                     | — (out port only) |
| **Exit** (system)      | 120×36 pill | `Exit`, red header                                                                                      | — (in port only)  |
| **Clip state**         | 180×72      | clip id (secondary colour), loop glyph from `style.kind`, speed badge (`1.0×`, or `↝ input` when bound) | 4 px progress bar |
| **1D blend**           | 200×96      | driver input badge (`speed`), one row per child: name + weight bar                                      | idem              |
| **2D blend**           | 200×112     | 84×84 mini grid with child dots, a live `(x,y)` sample dot, driver badges `X: velX  Y: velZ`            | idem              |
| **Direct**             | 220×…       | one row per `DirectEntry`: `input → bone.channel` or `input → mesh/target`, plus its weight meter       | idem              |

Two badges earn their space: a **warning badge** (`⚠`) when `validateDefinition` reports an
issue whose path points at that node, and a **missing-clip badge** when the clip id does not
resolve — the node draws dashed and the tooltip is the resolver's message verbatim.

### 6.D Telemetry (the part that makes it a Rive-like tool)

When `PlayState === "playing"`:

1. **Active state glow**: 2 px ring in the layer's accent colour plus 8 px outer bloom, on the
   node whose state equals `telemetry[layer].state`. The ring is CSS (`box-shadow`) —
   no canvas redraw, no filter, no re-render of the card (the ring lives in
   `TelemetryRing`, a sibling that subscribes on its own).
2. **Progress**: the footer bar fills from the same telemetry, `transform: scaleX()` with
   `transform-origin: left`. Scale, not width — width relayouts the card every frame.
3. **Crossfade**: while `telemetry[layer].transition != null`, both endpoint nodes show a
   weight pill (`62%` / `38%`), and the noodle gets an **animated fill**: a second path on
   top, `stroke-dasharray` = path length, `stroke-dashoffset` driven from
   `transition.progress` via a CSS custom property written on the `<path>` element
   (`el.style.setProperty("--p", String(p))`). The noodle fill must not re-render the graph
   either; one DOM write per frame per active transition, at most a handful.
4. **Marker pulses**: a small tick travels the noodle at a `marker` event (80 ms), so a
   footstep is visible in the graph at the moment it fires.
5. **Blocked/queue feedback**: `blocked` event → the target node flashes amber once,
   tooltip "dropped: interruption policy".

Paused (`stopped`): telemetry is frozen at its last values and drawn at 40 % opacity, so
"where was I" survives a stop.

---

## 7. Zone 3, mode B — timeline

### 7.A Breadcrumb and modes

```
Graph › Locomotion › Idle › AstroScene/Head                        [ ⇤ back to graph ]
```

Clicking any crumb jumps to that selection. `⇤` returns to the graph with the state still
selected — the round trip in §9.c must not lose the user's place.

**Split view** docks this pane on the right 40 % of the stage. The layout is `flex`, both
halves independently scrollable, and the splitter remembers the ratio per machine.

### 7.B Clip strip — the part this pane owns

The pane is the **machine's** view of a clip, not a keyframe editor (§7.D). It is a 320 px
strip above the marker ruler:

| Control                    | Behaviour                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| clip identity              | `<sheet>/<object>`, duration, and the resolver status; a missing clip is red with the resolver's message                                                                                                                                 |
| **speed multiplier**       | number + `↝ bind`. A literal writes `ClipState.speed` (or `TimelineDef.speed` when the clip is a standalone timeline) — **per clip, per machine**: speeding up `Blink` must not touch `Sleep`. Binding writes `speed: { input, scale }`. |
| loop mode                  | `Once / Loop / Ping-Pong` + `onEnd`; reads and writes `state.style`. Shown read-only when the clip is opened from the asset list rather than from a state, because then no state owns it.                                                |
| **Open in Theatre Studio** | focuses Studio on this clip's sheet + object (§7.D)                                                                                                                                                                                      |
| ▶ / ⏸ preview              | plays the clip in the viewport (`PREVIEW`), confined to the work area; **does not write the definition**                                                                                                                                 |

Preview is deliberately separate from the definition: dragging a playhead must never edit a
state's speed or loop mode. The strip edits the definition; the transport previews it.

### 7.C Markers strip (machine-owned, this is the only keyframe-adjacent UI)

A single ruler, full width, with pins. Nothing else is drawn on it — no key diamonds, no
tangents, because those live in Theatre (§7.D).

- `+ marker` at the playhead, or right-click any time: `{ time, name, payload }`.
- Drag a pin to move it (`Shift` snaps to 5 %), double-click to rename, `Del` to delete.
- The write target is **where the runtime reads it**: `TimelineDef.markers[]` when the state
  references a standalone timeline, otherwise the state's own `markers[]`. The strip's
  header names the owner (`markers of Locomotion/Walk`) so a pin can never land on a timeline
  nobody plays.
- Pins are validated at save: empty name, duplicate name at the same time, `time > duration`
  (the last one is clamped with a warning, not rejected — the clip may be re-timed).

### 7.D Keyframes are Theatre's — this pane does not edit them

**There is no dope sheet and no curve editor in this pane, in any phase.** Theatre Studio
already is the keyframe/curve editor for this project: it owns tangents, handles, undo, and
the Save button that writes `states/*.json`. A second editor over the same file is the
two-writer bug this repository has already been bitten by, and a _read-only_ dope sheet is
worse than none: it costs a month of layout work to show a picture that Theatre shows better.

What the pane shows instead is a **clip manifest**, regenerated from `theatreTracks.ts`:

```
AstroScene/Blink  ·  0.60 s  ·  1 track  ·  3 channels
  bones      head          rotation            2 keys
  morphs     head>blink    weight            4 keys
```

That is enough to answer "is this clip wired the way I think?" and it is strictly
read-only. The actual editing path is one button:

**`Open in Theatre Studio`** → `openStudio()` + select `<sheetId>` for the clip's scene and
the clip's object key, then focus the Studio's timeline. Concretely: `getProject()` is a
module singleton (`infrastructure/theatre/project.ts`), so the editor drives
`project.sheet(sheetId)` and the Studio's own selection API, and the Studio panel is shown
(`ensureStudio()`); if the panel was hidden by a page (`/showcase` hides it), the button
un-hides it first. The browser tab keeps the editor mounted behind the Studio overlay, so
returning is an `Esc`, not a re-navigation.

**The isolation rule this requires.** Each clip must be backed by its **own Theatre sheet**
(or its own object within a per-clip sheet), never by a shared sequence: the same bone or
morph property is keyframed independently in `Idle`, `Blink` and `Sleep`, and two tracks over
one sheet would overwrite each other's values. The state machine is what samples and blends
the separately-evaluated clips — the runtime already resolves per `"<SheetId>/<ObjectKey>"`,
so the authoring side is where the guarantee lives:

- one sheet per clip family (`AstroScene/Blink` → sheet `BlinkClip`), or one sheet per scene
  with **one object per clip** if the clips share a rig (the cheaper option, and the one
  `theatreTracks.ts` already enumerates by object);
- the editor's `+ new timeline` creates the sheet/object pair and does **not** duplicate an
  existing one;
- selecting a timeline in the sidebar always resolves to exactly one `(sheetId, objectKey)`,
  and the strip shows that pair, so "which sheet is this clip?" is never a guess.

Speeds are per clip by construction (`ClipState.speed` / `TimelineDef.speed`), so fast
`Blink` and slow `Sleep` never share a clock. Nothing in this pane ever writes to a Theatre
track.

---

## 8. Zone 4 — inspector

Header: selection kind + name + breadcrumb (`Locomotion / Idle`), then a body. Every editor is
a controlled input over `EditorDoc`; two-way binding is one `commit(command)` per gesture.
Numeric fields: click to type, drag to scrub, `↑↓` ±1 step, `Shift` ×10.

### 8.A Clip state

| Field        | Control                                                                   | Notes                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| name         | text                                                                      | inline rename, refactors transition `from`/`to`                                                                                              |
| clip         | dropdown of resolvable clips                                              | shows duration + sheet; a missing clip renders red with the resolver's message                                                               |
| play style   | segmented `Once / Loop / Ping-Pong` + `onEnd` (`stop/hold/loop`) for once | maps to `style.kind`                                                                                                                         |
| speed        | number + `↝ bind` toggle                                                  | binding to a number input writes `speed: { input, scale }`; unbinding restores the literal                                                   |
| scrub        | `bind to <number>` + range hint                                           | `scrub` mode: playhead = input × duration; a live mini playhead shows the input's current value; the field warns when the input is unbounded |
| additive ref | clip dropdown, only when the layer is additive                            | inherits the layer default when blank                                                                                                        |
| tags         | chip input                                                                | free-form, used by `hasTag` (runtime gap §14)                                                                                                |
| timeline     | link                                                                      | "open timeline" → §9.c                                                                                                                       |

### 8.B 1D blend state

- Driver dropdown (number inputs only), readout of the live driver value.
- **Threshold bar**: 64 px tall, full width; one draggable diamond per child at
  `(threshold − min)/(max − min)`; the driver's live value is a vertical line with a triangle
  header; each diamond draws its influence curve (a tent, ±half the neighbour gap) filled to
  the live weight. Dragging a diamond past its neighbour **reorders** the children rather
  than rejecting the drag — that is what a user means by it.
- Below: child table `clip | threshold (numeric) | speed | weight %`. Weight is a meter,
  read-only, updated from telemetry at the same 0.5 % granularity as the graph.
- Bounds row: `min`/`max` of the axis, with "fit to children" button.

### 8.C 2D blend state

- `X driver`, `Y driver` dropdowns; `blend type` segmented **`Directional` /
  `Freeform Cartesian`** — exactly the two the runtime samples (`weightsBarycentric`). A
  third option is not shown, not even disabled: an option that never works is a promise the
  UI cannot keep.
- **Blend pad**: square, 260×260, axes labelled with the drivers and their ranges, child
  dots draggable (snap to 0.05 with `Shift`), influence rings sized by live weight,
  triangulation drawn faintly for cartesian. A **red preview dot** is the live cursor: while
  dragging it, the UI writes both number inputs (throttled to one write per animation frame,
  not per pointermove) so the viewport previews the blended pose for real.
- Child table: `clip | X | Y | weight %`, plus `+ child` (appends at the centre) and remove.

### 8.D Direct blend node

Table rows, one per `DirectEntry`:

```
[ speed ▾ ]  in 0.00 … 6.00   zero 0.00   [ Morph ▾ head/blink            ]  ████░░ 62%
[ aim   ▾ ]  in -1.0 … 1.00   zero 0.00   [ Bone  ▾ hand/rotation.x       ]  ██░░░░ 30%
```

- Row composer: input, input range `min`/`max` (the runtime's `DirectEntry.range`), `zero`
  (the input value that maps to 0), target kind, target picker, live meter.
- **The target union is bone-channel or morph-target, nothing else**
  (`DirectEntry.target`): `bone` + channel (`position.x…scale.z`) or `{mesh, target}`. There
  is no "additive clip" target in the runtime, so the UI must not offer one — an additive
  _look_ is a layer-level thing (§8.F), not a direct row.
- Target picker for morphs lists `mesh > target` from `definition.groups.morph`; for bones
  it lists the rig's bone names from `RigDescription`. It refuses a duplicate
  `<bone, channel>` (the runtime's last-writer rule).
- Reordering rows does not change semantics (each entry is independent) but is preserved.

### 8.E Transition noodle

Header: `Idle → Walk · #1`, plus a `⇄ reverse` action that swaps `from`/`to` and inverts
nothing else (the conditions are about the source state; the UI says so before swapping).

| Group        | Controls                                                                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timing       | `duration` (ms/s toggle, default 200 ms), easing preset picker (Linear, Ease In, Ease Out, Ease In-Out, Cubic) with a curve preview; `syncTime` checkbox ("continue the target at the source's phase"); `consumeTriggers` (default on) |
| Exit time    | checkbox + 0.00–1.00 slider + number; showing it on a direct state disables it with the validator's message (the runtime rejects `exitTime` on a state with no time axis)                                                              |
| Interruption | dropdown `ignore / interrupt / queue` with one-line explanations, defaulting to `options.defaultInterruption` and marked "inherit" when unset                                                                                          |
| Conditions   | builder, §8.E.1                                                                                                                                                                                                                        |

**8.E.1 Condition builder**

```
ALL ▾   ( ALL (AND) | ANY (OR) | NOT )
  [ speed ▾ ] [ > ▾ ] [ 0.5 ]        ✕
  [ grounded ▾ ] [ == ▾ ] [ true ▾ ] ✕
  [ jump ▾ ]    ( trigger badge )    ✕
  + condition          + group
```

- Group toggle is `ALL`/`ANY`/`NONE (= NOT)`; groups nest one level (the runtime's
  `Condition` is recursive; the builder allows depth 2 and _shows_ deeper trees read-only
  with a notice, so a hand-authored file cannot be silently destroyed by the editor).
- Operators depend on kind: number `== != > < >= <=`; boolean `== !=`; trigger is a bare
  badge ("fires"), with a `shared` chip when the input declares it.
- Hysteresis (number leaves support it in the runtime) is a `±` field revealed by `…`.
- Rows are drag-reorderable; deleting a row is one command.
- The builder writes `when` and nothing else — `exitTime` and conditions are independent
  gates, and the UI never folds them together.

### 8.F Layer

| Group    | Controls                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity | name, priority (`↑↓` + numeric), blend mode segmented `Override / Additive`, `additiveRef` picker when additive                                                 |
| Weight   | slider 0–1 + number + `↝ bind` (`{ input, scale }`)                                                                                                             |
| Mask     | mask picker (`none`, named masks, `inline`) — see below                                                                                                         |
| Entry    | list editor for `entry[]`: `→ state`, condition (reuse §8.E.1 in a compact form), fade seconds; the last row must be unconditional and the UI keeps it that way |

**Mask editor** (inline mask or editing a named one):

- **Bone silhouette + tree**: a humanoid silhouette (a static SVG, six regions: head, torso,
  left arm, right arm, legs, hands/fingers) where clicking a region toggles every bone in
  that subtree, plus a searchable checkbox tree of actual bones from `RigDescription`.
  Tri-state checkboxes (all/none/some) because `includeDescendants` makes subtrees the common
  case.
- **Mesh & morph filter**: checklist of meshes and morph groups with the same tri-state, plus
  the per-entry weight field (`0.5` on a bone = half the layer's contribution on that bone —
  the runtime is per channel, so the row says "per channel").
- `default` policy row: what happens to unlisted channels (`bones: 0 | 1`, `morphs: 0 | 1`).
- A "preview mask" toggle paints the affected bones in the viewport (a skeleton overlay with
  masked bones in accent, others at 12 % opacity) — the only way to see a mask without
  playing.

### 8.G Timeline / clip inspector

For a timeline selected from the asset panel: sheet, object, duration, channels, the morph
curve ids, and the **machine markers** table (`time`, `name`, `payload`) that writes wherever
the runtime reads them (`TimelineDef.markers[]`, or the referencing state's `markers[]`,
§7.C). Plus "used by" (states that reference this clip) — a delete that ignores that list is
how a machine stops loading.

### 8.H Listener inspector

The full composer behind §5.C: target, event, action, plus `enabled`, `minWeight` (only act
when the layer's weight is above this — prevents a facial listener firing under a muted
layer), and a `Test` button that synthesises the hit once.

---

## 9. Interaction flows

Each flow is written as **action → observable**. Anything that writes a store is named,
because "the UI updates" is what we are specifying.

### 9.a Create an input and wire a conditional transition

1. Sidebar → Inputs `+` → `Number`. A new row appears in edit mode at the bottom with the
   name `speed` selected. _(doc: inputs.push; undoable)_
2. Type `walkSpeed`, `Enter`. Range editor opens inline (`min 0`, `max 6`, `default 0`,
   `smoothTime 0`). Accept. _(doc: input committed; validation re-run; header shows "1 input")_
3. Graph: click `Idle`, then drag from its output port to `Walk`. A dashed noodle previews
   under the cursor; dropping on `Walk` creates `{from: idle, to: walk}` and **selects it**.
   _(doc: transitions.push; inspector switches to §8.E)_
4. Inspector → Conditions → `+ condition`. Row: `[dropdown] [op] [value]`. The dropdown lists
   every number/boolean/trigger input; `walkSpeed` is there and shows its range. Pick
   `walkSpeed`, `>`, type `0.5`. _(doc: when = {all:[…]}; graph noodle gets a dot indicating
   "has conditions")_
5. Timing: duration `150 ms`, easing `Ease In-Out`. Interruption `interrupt` (tooltip:
   "a new trigger cuts the fade and blends from the pose on screen"). _(doc)_
6. Press ▶. Viewport badge switches to `MACHINE`; `Idle` glows, its bar advances.
7. Drag the `walkSpeed` scrubber past 0.5. The `Idle → Walk` noodle's fill runs 0→100 % over
   150 ms, `Idle` shows `38 %`, `Walk` `62 %`, both bars advance, and on completion `Walk`
   is the sole glow. _(runtime: `setNumber` → transition → telemetry)_
8. Failure path: type `0` and the machine stays in `Idle`, but a `blocked` event is only
   emitted for _dropped_ cuts — so the UI instead shows a condition-status chip on the
   selected noodle: `walkSpeed > 0.5  ✗ (0.00)`. That chip is computed in the editor from
   the draft + the live inputs, not from the runtime; it is the single most useful debugging
   affordance in the whole tool.
9. `Ctrl+S` writes `machines/<id>.machine.json`; the dirty dot clears; `/machine` picks it up
   on reload.

### 9.b Build and live-scrub a 2D blend space

1. Graph: `+ state` → `2D blend`. A node appears at the click, unnamed, selected.
   _(doc: states.push)_
2. Inspector → name `Strafe`; `X driver = velocityX`, `Y driver = velocityZ`; type
   `freeform cartesian`. _(doc)_
3. Pad is empty except a red dot at (0,0) and a hint: "add 4 children at the corners". `+
child` ×4; each child appears as a dot at the pad centre and as a row in the table.
4. Drag child #1 to the top-left corner (`-1, 1`), assign clip `Strafe/forward-left`;
   `Shift` snaps to 0.05. _(doc: children[0].x/y)_. Repeat for the other three.
5. Click the node's input port test area ("preview") — the pad's red dot follows the mouse
   _inside the pad only_; dragging it writes `setNumber("velocityX", x)` and
   `setNumber("velocityZ", y)` at one write per animation frame. The viewport immediately
   shows a blended pose; the four dots grow rings sized to their weights; the node's mini
   grid mirrors it. _(runtime: `setNumber` ×2 → sample → telemetry)_
6. Release. The dot stays where released (it is a live cursor, not a spring back to centre);
   a `reset to 0,0` chip appears next to it.
7. The child table's weight column animates; the sum must read 100 % ±0.1 — if the runtime
   reports otherwise, the table shows a `⚠ Σ 97 %` chip (that is a real bug, and burying it
   in a bar chart would hide it).
8. Acceptance: no React re-render of the node card during the scrub (verified by the render
   counter in dev), and the pose changes on the same frame as the input write.

### 9.c State node ↔ underlying 3D timeline ↔ morph curve

1. Graph: double-click `Walk`. _(ui: mode = timeline, selection = timeline, previewClip =
   clip of the state)_; zone 3 animates to the timeline; viewport badge `PREVIEW
AstroScene/Head`.
2. Breadcrumb reads `Graph › Locomotion › Walk › AstroScene/Head`; pressing `Esc` or clicking
   `Graph` returns with `Walk` still selected.
3. In split view (mode = split before step 1), the graph stays visible on the left and the
   now-selected node is highlighted in the graph — the link the brief asks for.
4. The strip shows the clip's speed (per clip, per machine) and loop mode; preview ▶ plays
   it with work-area looping, and the playhead drag scrubs the viewport live (the runtime is
   not stepped at all in preview).
5. The manifest lists `bones  head  rotation  2 keys` and `morphs  head>blink  weight  4
keys` — enough to confirm the clip is wired. **There is no dope sheet to expand**: pressing
   **Open in Theatre Studio** focuses that clip's sheet + object and hands the tab to Theatre,
   where the keys, tangents and curves are edited and saved. Returning is `Esc`.
6. Add an event marker: right-click the marker ruler at 0.42 s → "add marker" → name
   `footstep_left`. _(doc: markers.push on the owner the state references — `timelines[]` or
   the state itself, §7.C)_ — the pin is drawn on this strip and is independent of every
   Theatre keyframe, because it is not one.
7. Return to the graph, press ▶: as the playhead crosses 0.42 s the marker fires, the
   noodle/none flashes, and the event log shows `marker footstep_left`. _(runtime:
   `marker` event)_
8. Failure path: if the state's clip is missing, step 1 opens the timeline with an empty
   track list and the inspector shows the resolver's message; the node stays dashed.

### 9.d Live-test the machine in the viewport

1. Press ▶. Badge `MACHINE`; the viewport's camera is now driven by the scene rig (or the
   inspector's `focus bone`), not by preview.
2. Sidebar inputs are live; dragging a number scrubs blend spaces; toggling a boolean flips
   conditions; pressing a trigger pulses and the pending dot disappears when consumed.
3. Graph: active state glows per layer; a crossfade shows both weights and an animated
   noodle; a `blocked` cut flashes amber.
4. Viewport HUD: `fps`, `frames`, `bones written`, `morph writes`, and the same numbers the
   `/machine` page shows — the editor must not have a separate definition of "healthy".
5. Any listener appears as a small icon in the HUD when it fires (`Head → poke`), so a
   mis-targeted collider is visible without opening a console.
6. Stop (`■`): telemetry freezes at 40 % opacity, active nodes keep their last progress so
   the state on screen is still readable.
7. Editing while playing follows §4.5; the header shows `rebuilt` for 2 s after a structural
   edit.

---

## 10. Synchronization contract

The four zones do not talk to each other. They read and write three sources; this table is
the whole contract.

| User action                  | Writes                                                                                          | Notification path                               | Readers that update                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| select node / noodle / layer | `EditorUi.selection`                                                                            | store subscribe                                 | inspector, graph outline, breadcrumb                   |
| edit a field                 | `EditorDoc.definition` via one command                                                          | store subscribe + validation debounce (150 ms)  | inspector, graph badge, status bar, runtime on rebuild |
| drag a node                  | `EditorDoc` (positions live in `EditorUi` during drag, committed to the editor file on release) | store subscribe                                 | graph only                                             |
| play                         | `EditorUi.playState` → hook starts rAF                                                          | machine instance created from the current draft | viewport, telemetry ring, input deck                   |
| set input                    | `machine.setNumber/setBoolean/fire`                                                             | runtime → telemetry publisher (rAF)             | input deck ghost values, graph weights, viewport       |
| drag blend pad               | `machine.setNumber` ×2, at most once per rAF                                                    | as above                                        | viewport, pad, node mini-grid                          |
| scrub timeline               | `EditorUi.preview` (a module cursor over the clip)                                              | rAF                                             | viewport, playhead                                     |
| marker add/remove            | `EditorDoc`                                                                                     | as an edit                                      | timeline, inspector                                    |
| save                         | `saveMachine()`                                                                                 | status bar                                      | `/machine` on next load                                |
| Studio Save (Theatre)        | Theatre files                                                                                   | — (out of band)                                 | timeline pane on reload                                |

**Invariants**

1. **One writer per field.** `definition` is written only by `EditorDoc.commit`. Nothing else
   mutates it, including the runtime and the graph's drag code (which writes positions, not
   definition fields).
2. **Selection is not runtime state.** Selecting a state never changes what plays, and the
   runtime's active state never changes the selection. The highlight is the only bridge.
3. **Inputs are the only runtime channel.** The editor's "live" mode is the same black box a
   game would use; if a control cannot be expressed as `setNumber`/`setBoolean`/`fire`, it
   does not belong in the input deck.
4. **Preview bypasses the machine.** In `PREVIEW` the runtime is not stepped at all, and the
   badge says so. Mixed ownership of the viewport is the one thing that makes both modes
   untrustworthy.
5. **Telemetry is one-way and disposable.** Losing it (tab switch, rAF pause) must not affect
   the definition or the playhead. Telemetry is keyed `<machineId>/<layerId>` because a scene
   can run several machines at once (§1); the graph only reads the one being edited.
6. **One runtime instance per machine.** Two machines never share a `Machine`, an input
   snapshot or a cursor: "astronaut idle" and "face blink" are independent timelines with
   independent clocks, and a shared instance would make one machine's `Blink` retime the
   other's.
7. **External changes are observed, not merged.** If the Theatre file changes under an open
   editor, the timeline pane shows "the project state changed — reload" and the editor does
   not hot-reload the definition (a definition edit in flight would be lost silently).
8. **Save is explicit.** No autosave to the repo, for the same reason Theatre's autosave is
   off: a file the tool wrote must never overwrite a hand edit.

---

## 11. Performance and rendering budget

| Budget                    | Target                                                    | How                                                                                                   |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Graph interaction         | 60 fps with 120 nodes / 180 noodles                       | nodes are absolutely-positioned divs, noodles one `<svg>` layer; transform-only pan/zoom on a wrapper |
| Telemetry writes          | ≤ 1 per rAF, independent of machine frame rate            | publisher compares rounded values                                                                     |
| React renders during play | 0 outside the input deck + telemetry subscribers          | `useSyncExternalStore` per node; no store object in a component's closure                             |
| Viewport                  | the existing `MachineCanvas` budgets (dpr ≤ 1.5, no MSAA) | unchanged, §MainCanvas rules                                                                          |
| Memory                    | editor file ≤ 200 KB; undo stack ≤ 100 snapshots          | JSON snapshots                                                                                        |
| First paint               | graph + inspector ≤ 300 ms after route load               | layout from `*.editor.json`, no auto-layout on load unless no entries exist                           |

Anti-patterns this spec forbids: `useMemo`/`useCallback`/`React.memo` for perf (React
Compiler is on and does it better); a node card subscribing to the whole telemetry record; an
SVG re-render per frame for the noodle fill; storing the machine instance in a store.

---

## 12. Accessibility and input

- Every panel is a labelled region (`aria-label`), the graph is `role="application"` with an
  accessible _list_ alternative (a toggleable table view: state, clip, inbound, outbound) —
  a canvas the AT cannot read is a canvas a keyboard user cannot audit.
- Graph keyboard: `Tab` enters nodes in reading order (layer, then y, then x), `Enter`
  selects/opens, `Shift+Enter` multi-selects, `Del` deletes, arrows nudge, `T` starts a
  transition from the selected node (then `Tab` to the target, `Enter` to commit).
- Focus ring 2 px, never removed; all menu items reachable without a pointer.
- `prefers-reduced-motion`: glow pulses and noodle fills become static weight pills (no
  travelling dash), marker ticks disappear but their log line stays.
- Contrast: text on surfaces ≥ 4.5:1; state colours are _decorative_, never the only signal
  (the glow always paired with the name in bold and the progress bar).
- Colour-blind safety: override/additive badges are letters, not just colour; the 1D/2D
  weight bars carry a % readout.

---

## 13. Validation and error surfacing

`validateDefinition` already produces `{path, message}[]` with JSON paths. The editor maps
them onto UI:

| Path                             | Surface                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `layers[i].states[j].clip`       | node `⚠` badge + inspector field red + status bar count                                                 |
| `layers[i].transitions[k].when`  | noodle `⚠` + inspector condition group outline                                                          |
| `inputs[n]` (unused / duplicate) | input row amber dot, tooltip                                                                            |
| global (schema, version)         | blocking banner over the stage: "this definition cannot load", with the first 3 paths and a copy button |

Clicking a `⚠` badge selects the offending element — the error _is_ a navigation affordance.
The editor refuses to save a definition the loader would reject, and says which path; a
"save anyway" is deliberately absent (the runtime would refuse it anyway, and a file that
cannot load is worse than an unsaved edit).

---

## 14. Implementation mapping (what exists, what is new)

| Need                             | Today                                                     | Work                                                                         |
| -------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| definition load/save             | `machineDefinitionStore.loadDefinition`                   | add `saveMachine(id, def)` writing `machines/<id>.machine.json`              |
| validation                       | `validateDefinition` (1819 lines, path-bearing)           | none                                                                         |
| sampling, composition            | `sampleState`, `layerComposer`, `blendPoses`              | none                                                                         |
| weights for the 1D/2D inspectors | `weights1d`, `weightsBarycentric` (exported)              | reuse; do not reimplement the interpolation in the UI                        |
| Theatre tracks (manifest)        | `theatreTracks.ts`, `listTheatreClips`                    | none                                                                         |
| runtime instance                 | `useAnimationMachine`, `MachineCanvas`, `useMachineStore` | reuse for the viewport; add telemetry publisher + `subscribeTelemetry`       |
| Studio keyframes                 | Theatre Studio                                            | **not reimplemented**: `openStudio()` + select `(sheetId, objectKey)` (§7.D) |
| per-scene machine registry       | `machineDefinitionStore` (single demo definition)         | add `listMachines(scene)`, `saveMachine`, and `definition.scene`             |
| **runtime API gaps**             | **closed** — see below                                    | done in `createMachine.ts` + `runtimeApi.test.ts` (16 tests)                 |
| graph/nodes/noodles              | —                                                         | new: `presentation/editor/**` (components listed §3)                         |
| editor stores                    | —                                                         | new: `useEditorDoc`, `useEditorUi`                                           |
| editor file                      | —                                                         | new: `*.machine.editor.json` + codec                                         |

**The seven runtime members are implemented.** `Machine` gained `hasTag`,
`getActiveTransition`, `getSmoothedNumber`, `isTriggerPending`, `once(event, listener,
filter?)`, `getRootMotion()`, and `MachineOutput.rootMotion`; `MachineEvents` gained
`transitionComplete`. Three of them needed a definition field to be honest about:

- `tags?: string[]` on the definition, a layer, a state (`StateBase`) and a transition.
  Nothing in the runtime branches on a tag, so adding one is never a behaviour change.
- `options.rootBone?: string`. Without it the machine reports zero root motion, which is the
  right answer for a rig that moves the model root itself. The published value is a **delta**
  and the first frame after the root appears is zero — a delta against "no previous position"
  would teleport the model to wherever the clip starts.
- `transitionComplete` fires when a fade reaches its end, and **also on a cut whose duration
  is 0** (that cut builds no record at all, so a `once` waiting for the completion would
  otherwise wait forever). It is distinct from `stateEnter`, which fires when the cut
  _starts_. A queued cut that replaces an unfinished fade does not fire it for the fade it
  interrupted.

**Two bugs found by the tests that came with them:**

1. `smoothToward` (in `inputStore.ts`) clamped the change to `smoothTime * velocity`. At rest
   velocity is 0, so the clamp forced the change to 0 and every smoothed number jumped to
   its target on the first frame — a smoothed input indistinguishable from an unsmoothed one,
   and the editor's raw-vs-smoothed readout would have drawn one number twice. The closed form
   is already non-overshooting, so the clamp is gone.
2. The root-motion delta kept a **reference** to the sampled position array, which the sampler
   reuses every frame — the delta would have been permanently zero. It copies now.

The dependency warning this section used to carry is resolved: telemetry no longer needs
`MachineRuntime` internals, because a fade's two ids, its progress and its `live`/`frozen`
source are all on `getActiveTransition`.

---

## 15. Milestones

| #      | Scope                                                                                                              | Acceptance                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Shell + 4 zones + viewport + `useEditorDoc`/`useEditorUi` + open/save                                              | a definition loads, the viewport plays it, moving splitters persists, save round-trips through the loader                                                        |
| **M1** | Graph read + auto-layout + selection + telemetry (glow/progress/weights)                                           | flow §9.d works end-to-end with no React render during play beyond the input deck                                                                                |
| **M2** | Inspector: clip state, layer, transition + condition builder                                                       | flow §9.a works, including rename refactor and the ✗ condition chip                                                                                              |
| **M3** | 1D + 2D blend inspectors with live scrub                                                                           | flow §9.b works; the Σ-weight chip is correct                                                                                                                    |
| **M4** | Timeline mode: clip strip (speed/loop), marker strip, manifest, split view, breadcrumb, **Open in Theatre Studio** | flow §9.c works; markers round-trip where the runtime reads them; speed is per clip and independent of the other clips; Studio opens on the right sheet + object |
| **M5** | Mask editor, listeners panel, direct node inspector, validation badges                                             | all §13 paths navigable; a masked layer is visible in the viewport preview                                                                                       |

Each milestone ends with `vp check` / `vp test` green and no new non-pure logic in `core/`
(the editor is `presentation/` + `infrastructure/`; the only `core/` additions are pure
functions such as rename-refactor and layout, both with tests).

---

## 16. Resolved decisions (were open questions)

All five are decided; recorded here so a future change has to argue with a decision, not with
silence.

1. **Gating — dev only.** `import.meta.env.DEV` **and** `!Capacitor.isNativePlatform()`
   **and** a `>= 1024 px` viewport, matching `initTheatreStudio()`. No tablet/touch story is
   built; the phone renders the notice in §1 and links to `/machine`.
2. **Many machines per scene.** `definition.scene` groups them; a scene holds as many
   independent machines and timelines as the animator wants, each machine with 1..M layers.
   Machines are siblings, never nested; the app may step several at once because each is its
   own `Machine` instance (§1).
3. **The timeline pane never writes Theatre keys.** Keyframes, tangents and curves are
   edited in Theatre Studio via **Open in Theatre Studio**, which focuses the clip's sheet +
   object; the pane owns only `ClipState.speed` / `TimelineDef.speed`, loop mode, and machine
   `markers[]` (§7.B–§7.D). Each clip is its own isolated sheet/object, so one property can
   be keyframed independently in every clip and the runtime does the sampling and blending.
4. **Blend types — cartesian + directional only.** No `bilinear grid`, not even as a disabled
   option (§8.C).
5. **Masks stay in the definition.** `definition.masks` + inline layer masks inside
   `<id>.machine.json`, so the runtime definition is self-contained and the editor file stays
   pure UI state (§4.4).
