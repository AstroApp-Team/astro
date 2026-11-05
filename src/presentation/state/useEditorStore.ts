/**
 * The editor's draft, its workspace file, and the two stacks.
 *
 * A `MachineDefinition` is the machine; `EditorFile` is the workspace around it. This store
 * keeps them apart on purpose — a save writes both, but only the definition can change what
 * the runtime does, so only a definition edit sets `dirty` and only a structural one counts as
 * a rebuild (§4.5).
 *
 * Three rules that make the rest of the UI simple:
 *
 * 1. **Every edit goes through `apply`.** It classifies the change (`structuralHash`), pushes
 *    the previous definition onto `past`, and marks the draft dirty. A component that mutated
 *    `definition` directly would skip all three, and the bug it produces — a save that writes
 *    the old shape, or an undo that returns to the middle of an edit — is invisible until it
 *    loses work.
 * 2. **The session is not the file.** Hover, marquee and play state reset on reload; node
 *    positions and splits do not. `session` is where the first group lives.
 * 3. **The URL is a second copy of the selection, not the source of it.** `selection` is a
 *    one-field store value (a click sets it, the graph renders from it), and the page syncs it
 *    to the query string so a reload reopens the same card. Decoding happens once, at mount.
 */

import { create } from "zustand";

import type {
  LayerDef,
  MachineDefinition,
  StateDef,
  TimelineDef,
  TransitionDef,
} from "@core/models/animationStateMachine.ts";
import type {
  EditorFile,
  EditorFocus,
  NodePoint,
  Selection,
  StageMode,
  ViewportMode,
} from "@core/models/animationStateMachineEditor.ts";
import { EMPTY_EDITOR_FILE } from "@core/models/animationStateMachineEditor.ts";
import {
  loadDefinition,
  loadShippedDefinition,
} from "@infra/theatre/animationStateMachine/machineDefinitionStore.ts";
import {
  addInput,
  addLayer,
  addListener,
  addState,
  addTransition,
  patchInput,
  patchLayer,
  patchListener,
  moveLayer,
  patchState,
  patchTransition,
  removeInput,
  removeLayer,
  removeListener,
  removeState,
  removeTransition,
  renameInput,
  renameState,
  withMarkers,
} from "@core/usecases/animationStateMachine/editorOps.ts";
import {
  classifyChange,
  structuralHash,
} from "@core/usecases/animationStateMachine/structuralHash.ts";
import { validateDefinition } from "@core/usecases/animationStateMachine/validateDefinition.ts";
import type { ListenerDef } from "@core/models/animationStateMachine.ts";

const MACHINE_ID = "machine-demo";

/**
 * Draft keys are per **scene**, not per machine.
 *
 * Two scenes share no definition: a state added while rigging `StingScene` used to appear in
 * `FloatScene`'s graph as well, and a clip id (`SheetId/ObjectKey`) resolved to nothing there.
 * The vendor file on disk is still one `machine-demo`; the drafts are keyed by sheet.
 */
function draftKey(sceneKey: string, machineId: string): string {
  return `astro.editor.${MACHINE_ID}.${sceneKey}.${machineId}.draft`;
}

/** One scene can hold several machines; the id is the draft key's last segment. */
export interface MachineEntry {
  id: string;
  name: string;
}
const FILE_KEY = `astro.editor.${MACHINE_ID}.file`;

/** Where the dev-only middleware lives (§4.3). A build has no such endpoint. */
const EDITOR_ENDPOINT = "/__astro-editor";

interface EditorStore {
  machineId: string;
  /**
   * Which scene's machine is open. `live` while the rig studio drives it; the `/editor` route
   * leaves it at the demo so its own bench keeps working unchanged.
   */
  sceneKey: string;
  /** Every scene+machine definition opened this session, keyed `${sceneKey}#${machineId}`. */
  sceneDefs: Record<string, MachineDefinition>;
  /**
   * The machines that exist per scene, and which one is open.
   *
   * A "scene" here is the runtime scene + sheet (`sting:StingScene`), because two scenes on one
   * sheet share no clips. Machines are per scene, not global: a state added while rigging the
   * sting character must not appear in the float page's graph — the clip ids resolve to nothing
   * there, and the graph would be showing a machine that can never play.
   */
  machines: Record<string, MachineEntry[]>;
  activeMachine: Record<string, string>;
  definition: MachineDefinition;
  file: EditorFile;
  past: MachineDefinition[];
  future: MachineDefinition[];
  dirty: boolean;
  /* Read-only: which definition is open. Not the same as `dirty` — a Studio save is clean. */
  source: "shipped" | "local";
  error: string | null;
  status: string;
  /**
   * Which machine timeline the dope sheet is showing, or `null` for the whole sheet.
   *
   * A timeline is a sequence with its own props and its own window of the sheet (see
   * `TimelineDef.props` / `length` / `offset`). Without a focus the deck shows every track, which
   * is the right default on a sheet with one clip and the wrong one the moment there are two.
   */
  focusedTimeline: string | null;

  /* session — never persisted */
  mode: StageMode;
  focus: EditorFocus;
  selection: Selection;
  hovered: Selection;
  filter: string;
  previewClip: string | null;
  playing: boolean;
  viewportMode: ViewportMode;
  table: boolean;
  rebuild: string | null;

  /* actions */
  apply: (next: (definition: MachineDefinition) => MachineDefinition) => void;
  undo: () => void;
  redo: () => void;
  discard: () => void;
  save: () => Promise<void>;
  load: () => void;
  /** Fetch the workspace file once per session: `localStorage` is the draft, disk is the file. */
  hydrate: () => Promise<void>;
  /**
   * Open a scene's machine, creating it from `seed` the first time.
   *
   * The current definition is stashed under its own scene key, so switching scenes is not a
   * `discard`: unsaved edits survive until the tab closes.
   */
  switchScene: (sceneKey: string, seed: () => MachineDefinition, force?: boolean) => void;
  /** Add a machine to the open scene, seeded from `seed`, and switch to it. */
  newMachine: (seed: () => MachineDefinition, name?: string) => void;
  selectMachine: (machineId: string) => void;
  deleteMachine: (machineId: string) => void;

  select: (selection: Selection) => void;
  hover: (selection: Selection) => void;
  setMode: (mode: StageMode) => void;
  setFocus: (focus: EditorFocus) => void;
  setFilter: (filter: string) => void;
  setPreviewClip: (clipId: string | null) => void;
  setPlaying: (playing: boolean) => void;
  setViewportMode: (mode: ViewportMode) => void;
  setTable: (table: boolean) => void;
  setStatus: (status: string) => void;
  setError: (error: string | null) => void;
  setRebuild: (reason: string | null) => void;

  moveNodes: (moves: Record<string, NodePoint>) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: NodePoint) => void;
  setSplits: (splits: Partial<EditorFile["splits"]>) => void;
  toggleCollapsed: (key: keyof EditorFile["collapsed"]) => void;
  setDebug: (debug: Partial<EditorFile["debug"]>) => void;

  addState: (layerId: string, init?: Partial<StateDef>) => string | null;
  removeState: (layerId: string, stateId: string) => void;
  renameState: (layerId: string, from: string, to: string) => string | null;
  patchState: (layerId: string, stateId: string, patch: Partial<StateDef>) => void;
  addTransition: (layerId: string, from: string, to: string, anyState?: boolean) => void;
  patchTransition: (layerId: string, index: number, patch: Partial<TransitionDef>) => void;
  removeTransition: (layerId: string, index: number, anyState?: boolean) => void;
  addLayer: (id: string) => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, delta: -1 | 1) => void;
  patchLayer: (id: string, patch: Partial<LayerDef>) => void;
  addInput: (kind: "number" | "boolean" | "trigger") => void;
  renameInput: (from: string, to: string) => boolean;
  removeInput: (name: string) => void;
  patchInput: (name: string, patch: Record<string, unknown>) => void;
  addListener: (listener: ListenerDef) => void;
  patchListener: (index: number, patch: Partial<ListenerDef>) => void;
  removeListener: (index: number) => void;
  setMarkers: (layerId: string, stateId: string, markers: { time: number; name: string }[]) => void;

  /** Add a timeline (§5) and return its id. `id` is never reused: the ordinal keeps climbing. */
  addTimeline: (init?: Partial<TimelineDef>) => string;
  /** Remove a timeline. Refused while a state still references it — see the action's note. */
  removeTimeline: (timelineId: string) => { ok: boolean; reason?: string };
  patchTimeline: (timelineId: string, patch: Partial<TimelineDef>) => void;
  /** Point the dope sheet at one timeline (or back at the whole sheet with `null`). */
  focusTimeline: (timelineId: string | null) => void;
  /** Bind a state to a timeline, or (for `state !== null`) create the state first. */
  bindTimeline: (layerId: string, timelineId: string, stateId: string | null) => string | null;
  /**
   * Insert a timeline "between" two states: the transition `from → to` is replaced by
   * `from → S → to`, where `S` carries the timeline. This is what dropping a timeline on a
   * connecting line means — a transition cannot own a clip, so the drop earns one a state.
   */
  insertTimeline: (
    layerId: string,
    timelineId: string,
    from: string,
    to: string,
    index: number,
    anyState?: boolean,
  ) => void;
}

function readJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A full quota must not break editing; the explicit save is the real persistence. */
  }
}

/** The shipped definition, or the local draft if the last save did not reach disk. */
function loadDraft(): {
  definition: MachineDefinition;
  source: "shipped" | "local";
  dirty: boolean;
} {
  const shipped = loadShippedDefinition(MACHINE_ID);
  const draft = readJson<{ definition?: unknown }>(draftKey("machine-demo", "main"))?.definition;
  if (draft == null) return { definition: shipped, source: "shipped", dirty: false };
  try {
    return { definition: loadDefinition(draft), source: "local", dirty: true };
  } catch {
    /* A draft the loader rejects is not opened: it would make the editor's first save write
       something the runtime cannot play. The shipped file runs and the draft is kept on disk
       until `discard` clears it. */
    return { definition: shipped, source: "shipped", dirty: false };
  }
}

export const useEditorStore = create<EditorStore>((set, get) => {
  const initial = loadDraft();
  const storedFile = readJson<EditorFile>(FILE_KEY);

  /** The write path every mutator goes through: classify, push history, mark dirty, mirror. */
  const apply = (next: (definition: MachineDefinition) => MachineDefinition) => {
    const state = get();
    const definition = next(state.definition);
    if (definition === state.definition) return;
    /* §10: a command may refuse, but it may never write a definition the loader rejects —
       the preview builds a machine from the draft, and an invalid one takes the page down. */
    const report = validateDefinition(definition);
    if (!report.ok) {
      const first = report.errors[0];
      set({
        error:
          first == null
            ? "The edit produced an invalid definition."
            : `${first.path}: ${first.message}`,
      });
      return;
    }
    const structural = classifyChange(state.definition, definition) === "structural";
    const past = [...state.past, state.definition].slice(-60);
    set({
      definition,
      past,
      future: [],
      dirty: true,
      source: "local",
      error: null,
      ...(structural && state.playing ? { rebuild: "structural change" } : {}),
    });
    writeJson(draftKey(state.sceneKey, state.machineId), { definition, at: Date.now() });
  };

  return {
    machineId: "main",
    sceneKey: "machine-demo",
    sceneDefs: {},
    machines: { "machine-demo": [{ id: "main", name: "Demo machine" }] },
    activeMachine: { "machine-demo": "main" },
    definition: initial.definition,
    file: storedFile ?? { ...EMPTY_EDITOR_FILE, machineId: MACHINE_ID },
    past: [],
    future: [],
    dirty: initial.dirty,
    source: initial.source,
    error: null,
    status: "",
    focusedTimeline: null,

    mode: "graph",
    focus: "viewport",
    selection: null,
    hovered: null,
    filter: "",
    previewClip: null,
    playing: false,
    viewportMode: "machine",
    table: false,
    rebuild: null,

    apply,
    undo: () => {
      const { past, future, definition } = get();
      const previous = past.at(-1);
      if (previous == null) return;
      set({
        definition: previous,
        past: past.slice(0, -1),
        future: [definition, ...future].slice(0, 60),
        dirty: true,
      });
    },
    redo: () => {
      const { past, future, definition } = get();
      const next = future[0];
      if (next == null) return;
      set({
        definition: next,
        past: [...past, definition],
        future: future.slice(1),
        dirty: true,
      });
    },
    discard: () => {
      const shipped = loadShippedDefinition(MACHINE_ID);
      set({
        definition: shipped,
        past: [],
        future: [],
        dirty: false,
        source: "shipped",
        error: null,
        status: "Discarded — the shipped definition is open.",
      });
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(draftKey(get().sceneKey, get().machineId));
      }
    },
    save: async () => {
      const { definition, file, machineId } = get();
      const report = validateDefinition(definition);
      if (!report.ok) {
        set({
          error: report.errors
            .slice(0, 3)
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; "),
        });
        return;
      }
      const nextFile: EditorFile = {
        ...file,
        machineId,
        layout: {
          ...file.layout,
          zoom: file.layout.zoom,
        },
      };
      set({ status: "Saving…", error: null });
      try {
        const response = await fetch(`${EDITOR_ENDPOINT}/save`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-astro-editor-save": "1" },
          body: JSON.stringify({ id: machineId, definition, editor: nextFile }),
        });
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem(draftKey(get().sceneKey, get().machineId));
        }
        set({ dirty: false, source: "shipped", status: "Saved to disk." });
      } catch (error) {
        /* The endpoint is dev-only, so a production build always lands here. The draft stays
           in localStorage — that is the mirror's whole purpose — and the message says which
           of the two things happened rather than pretending the save worked. */
        set({
          status: "Kept locally — no editor endpoint in this build.",
          dirty: true,
        });
        if (import.meta.env.DEV) {
          set({ error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    hydrate: async () => {
      try {
        const response = await fetch(`${EDITOR_ENDPOINT}/file`);
        if (!response.ok) return;
        const body = (await response.json()) as { file?: EditorFile | null };
        if (body.file == null) return;
        /* localStorage wins when it exists: it is the newer edit — the file is what a Save
           last wrote, and a reload between two saves must not rewind the layout. */
        if (readJson<EditorFile>(FILE_KEY) != null) return;
        set({ file: { ...body.file, machineId: get().machineId } });
      } catch {
        /* No endpoint (a build, or a dev server without the plugin): localStorage only. */
      }
    },
    load: () => {
      const draft = loadDraft();
      set({ definition: draft.definition, dirty: draft.dirty, source: draft.source });
    },

    switchScene: (sceneKey, seed, force = false) => {
      const state = get();
      if (state.sceneKey === sceneKey && !force) return;

      /* Stash the open definition under the *pair* it belongs to, so coming back restores edits. */
      const stash = {
        ...state.sceneDefs,
        [`${state.sceneKey}#${state.machineId}`]: state.definition,
      };
      const known = state.machines[sceneKey] ?? [{ id: "main", name: "Main machine" }];
      const machineId =
        known.find((entry) => entry.id === state.activeMachine[sceneKey])?.id ??
        known[0]?.id ??
        "main";
      const key = `${sceneKey}#${machineId}`;
      let next = stash[key];
      if (next == null) {
        try {
          next = seed();
        } catch (error) {
          set({ error: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
      set({
        sceneKey,
        machineId,
        machines: { ...state.machines, [sceneKey]: known },
        activeMachine: { ...state.activeMachine, [sceneKey]: machineId },
        sceneDefs: { ...stash, [key]: next },
        definition: next,
        past: [],
        future: [],
        dirty: false,
        source: "local",
        selection: null,
        previewClip: null,
        focusedTimeline: null,
        error: null,
        status: `Machine: ${known.find((entry) => entry.id === machineId)?.name ?? machineId}`,
      });
    },

    /**
     * Add a machine to the open scene.
     *
     * The id is `machine-N`, never reused: two machines sharing an id share a draft key, and the
     * second one would open the first one's states. The seed comes from the caller because only it
     * knows the scene's clips — a machine seeded here would be an empty graph that cannot play.
     */
    newMachine: (seed, name) => {
      const state = get();
      const existing = state.machines[state.sceneKey] ?? [];
      let ordinal = existing.length + 1;
      while (existing.some((entry) => entry.id === `machine-${String(ordinal)}`)) ordinal += 1;
      const id = `machine-${String(ordinal)}`;
      const label = name ?? `Machine ${String(ordinal)}`;
      let definition: MachineDefinition;
      try {
        definition = seed();
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      set({
        machines: { ...state.machines, [state.sceneKey]: [...existing, { id, name: label }] },
        activeMachine: { ...state.activeMachine, [state.sceneKey]: id },
        sceneDefs: {
          ...state.sceneDefs,
          [`${state.sceneKey}#${state.machineId}`]: state.definition,
          [`${state.sceneKey}#${id}`]: definition,
        },
        machineId: id,
        definition,
        past: [],
        future: [],
        dirty: true,
        selection: null,
        error: null,
        status: `New machine: ${label}`,
      });
      writeJson(draftKey(state.sceneKey, id), { definition, at: Date.now() });
    },

    selectMachine: (machineId) => {
      const state = get();
      if (machineId === state.machineId) return;
      const next = state.sceneDefs[`${state.sceneKey}#${machineId}`];
      if (next == null) {
        set({ error: `Machine "${machineId}" has not been opened in this session.` });
        return;
      }
      const stash = {
        ...state.sceneDefs,
        [`${state.sceneKey}#${state.machineId}`]: state.definition,
      };
      set({
        machineId,
        activeMachine: { ...state.activeMachine, [state.sceneKey]: machineId },
        sceneDefs: stash,
        definition: next,
        past: [],
        future: [],
        dirty: false,
        selection: null,
        error: null,
        status: `Machine: ${
          state.machines[state.sceneKey]?.find((entry) => entry.id === machineId)?.name ?? machineId
        }`,
      });
    },

    deleteMachine: (machineId) => {
      const state = get();
      const existing = state.machines[state.sceneKey] ?? [];
      /* The last machine is the scene's machine: deleting it would leave the scene unriggable. */
      if (existing.length <= 1) {
        set({ error: "A scene needs at least one machine." });
        return;
      }
      const nextList = existing.filter((entry) => entry.id !== machineId);
      const fallback = nextList[0]?.id ?? "main";
      const nextId = machineId === state.machineId ? fallback : state.machineId;
      const nextDef =
        state.sceneDefs[`${state.sceneKey}#${nextId}`] ??
        (nextId === state.machineId ? state.definition : state.definition);
      const stash = { ...state.sceneDefs };
      delete stash[`${state.sceneKey}#${machineId}`];
      set({
        machines: { ...state.machines, [state.sceneKey]: nextList },
        activeMachine: { ...state.activeMachine, [state.sceneKey]: nextId },
        sceneDefs: stash,
        machineId: nextId,
        definition: nextDef,
        selection: null,
        error: null,
        status: `Deleted machine ${machineId}`,
      });
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(draftKey(state.sceneKey, machineId));
      }
    },
    select: (selection) => set({ selection }),
    hover: (hovered) => set({ hovered }),
    setMode: (mode) => set({ mode }),
    setFocus: (focus) => set({ focus }),
    setFilter: (filter) => set({ filter }),
    setPreviewClip: (previewClip) => set({ previewClip }),
    setPlaying: (playing) => set({ playing }),
    setViewportMode: (viewportMode) => set({ viewportMode }),
    setTable: (table) => set({ table }),
    setStatus: (status) => set({ status }),
    setError: (error) => set({ error }),
    setRebuild: (rebuild) => set({ rebuild }),

    moveNodes: (moves) => {
      const { file } = get();
      const nodes = { ...file.layout.nodes };
      const systemNodes = { ...file.layout.systemNodes };
      for (const [key, point] of Object.entries(moves)) {
        if (key.includes("__")) systemNodes[key] = point;
        else nodes[key] = point;
      }
      const nextFile: EditorFile = {
        ...file,
        layout: { ...file.layout, nodes, systemNodes },
      };
      set({ file: nextFile });
      writeJson(FILE_KEY, nextFile);
    },
    setZoom: (zoom) => {
      const clamped = Math.min(2, Math.max(0.35, zoom));
      const nextFile: EditorFile = {
        ...get().file,
        layout: { ...get().file.layout, zoom: clamped },
      };
      set({ file: nextFile });
      writeJson(FILE_KEY, nextFile);
    },
    setPan: (pan) => {
      const nextFile: EditorFile = { ...get().file, layout: { ...get().file.layout, pan } };
      set({ file: nextFile });
      writeJson(FILE_KEY, nextFile);
    },
    setSplits: (splits) => {
      const nextFile: EditorFile = {
        ...get().file,
        splits: { ...get().file.splits, ...splits },
      };
      set({ file: nextFile });
      writeJson(FILE_KEY, nextFile);
    },
    toggleCollapsed: (key) => {
      const nextFile: EditorFile = {
        ...get().file,
        collapsed: { ...get().file.collapsed, [key]: !get().file.collapsed[key] },
      };
      set({ file: nextFile });
      writeJson(FILE_KEY, nextFile);
    },
    setDebug: (debug) => {
      const nextFile: EditorFile = { ...get().file, debug: { ...get().file.debug, ...debug } };
      set({ file: nextFile });
      writeJson(FILE_KEY, nextFile);
    },

    addState: (layerId, init) => {
      const state = get();
      const layer = state.definition.layers.find((row) => row.id === layerId);
      if (layer == null) return null;
      const added = addState(state.definition, layerId, init?.type ?? "clip");
      apply(() => added.definition);
      set({ selection: { kind: "state", layer: layerId, state: added.stateId } });
      return added.stateId;
    },
    removeState: (layerId, stateId) => {
      apply((definition) => removeState(definition, layerId, stateId));
      set({ selection: null });
    },
    renameState: (layerId, from, to) => {
      try {
        apply((definition) => renameState(definition, layerId, from, to));
        set({ selection: { kind: "state", layer: layerId, state: to } });
        return to;
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
    patchState: (layerId, stateId, patch) =>
      apply((definition) => patchState(definition, layerId, stateId, patch)),
    addTransition: (layerId, from, to, anyState) =>
      apply((definition) =>
        addTransition(definition, layerId, from, to, anyState == null ? {} : { anyState }),
      ),
    patchTransition: (layerId, index, patch) =>
      apply((definition) => patchTransition(definition, layerId, index, patch)),
    removeTransition: (layerId, index, anyState) => {
      apply((definition) => removeTransition(definition, layerId, index, anyState));
      set({ selection: null });
    },
    addLayer: (id) => apply((definition) => addLayer(definition, id)),
    removeLayer: (id) => {
      try {
        apply((definition) => removeLayer(definition, id));
        set({ selection: null });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },
    moveLayer: (id, delta) => apply((definition) => moveLayer(definition, id, delta)),
    patchLayer: (id, patch) => apply((definition) => patchLayer(definition, id, patch)),
    addInput: (kind) => apply((definition) => addInput(definition, kind).definition),
    renameInput: (from, to) => {
      try {
        apply((definition) => renameInput(definition, from, to));
        set({ selection: { kind: "input", name: to } });
        return true;
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
    removeInput: (name) => {
      apply((definition) => removeInput(definition, name));
      set({ selection: null });
    },
    patchInput: (name, patch) => apply((definition) => patchInput(definition, name, patch)),
    addListener: (listener) => apply((definition) => addListener(definition, listener)),
    patchListener: (index, patch) => apply((definition) => patchListener(definition, index, patch)),
    removeListener: (index) => apply((definition) => removeListener(definition, index)),
    addTimeline: (init) => {
      const definition = get().definition;
      const timelines = definition.timelines ?? [];
      let ordinal = timelines.length + 1;
      while (timelines.some((row) => row.id === `tl-${String(ordinal)}`)) ordinal += 1;
      const id = init?.id ?? `tl-${String(ordinal)}`;
      const timeline: TimelineDef = {
        id,
        duration: init?.duration ?? 1,
        playStyle: init?.playStyle ?? { kind: "loop" },
        speed: init?.speed ?? 1,
        ...init,
      };
      apply((current) => ({ ...current, timelines: [...(current.timelines ?? []), timeline] }));
      return id;
    },
    removeTimeline: (timelineId) => {
      const users = get().definition.layers.flatMap((layer) =>
        layer.states.filter((state) => "timeline" in state && state.timeline === timelineId),
      );
      if (users.length > 0) {
        const names = users.map((state) => state.id).join(", ");
        return {
          ok: false,
          reason: `“${timelineId}” is still used by ${names}. Rebind or delete those states first.`,
        };
      }
      apply((current) => ({
        ...current,
        timelines: (current.timelines ?? []).filter((row) => row.id !== timelineId),
      }));
      if (get().focusedTimeline === timelineId) set({ focusedTimeline: null });
      return { ok: true };
    },
    focusTimeline: (timelineId) => {
      set({ focusedTimeline: timelineId });
    },
    patchTimeline: (timelineId, patch) =>
      apply((current) => ({
        ...current,
        timelines: (current.timelines ?? []).map((row) =>
          row.id === timelineId ? { ...row, ...patch } : row,
        ),
      })),
    bindTimeline: (layerId, timelineId, stateId) => {
      const timeline = (get().definition.timelines ?? []).find((row) => row.id === timelineId);
      if (timeline == null) return null;
      let target = stateId;
      if (target == null) {
        const layer = get().definition.layers.find((row) => row.id === layerId);
        if (layer == null) return null;
        const added = addState(get().definition, layerId, "clip");
        target = added.stateId;
        apply(() => added.definition);
      }
      apply((current) =>
        patchState(current, layerId, target, {
          type: "clip",
          timeline: timelineId,
          ...(timeline.clip == null ? {} : { clip: timeline.clip }),
        } as Partial<StateDef>),
      );
      set({ selection: { kind: "state", layer: layerId, state: target } });
      return target;
    },
    insertTimeline: (layerId, timelineId, from, to, index, anyState = false) => {
      const timeline = (get().definition.timelines ?? []).find((row) => row.id === timelineId);
      if (timeline == null) return;
      const added = addState(get().definition, layerId, "clip");
      const stateId = added.stateId;
      /*
       * Two applies, not one. The second reads `current` from the store, and the store's copy does
       * not contain the state `addState` just computed — patching it in the same `apply` throws
       * `no state "state-N" in layer "..."` and the drop silently does nothing. Committing the
       * state first (valid on its own: a clip state with its default asset) makes the transition
       * rewrite operate on a definition that has it.
       */
      apply(() => added.definition);
      apply((current) => {
        const removed = removeTransition(current, layerId, index, anyState);
        const bound = patchState(removed, layerId, stateId, {
          type: "clip",
          timeline: timelineId,
          ...(timeline.clip == null ? {} : { clip: timeline.clip }),
        } as Partial<StateDef>);
        /* An any-state edge comes from no state, so its replacement starts at the any pill too. */
        const first = addTransition(bound, layerId, from, stateId, { anyState });
        return addTransition(first, layerId, stateId, to, {});
      });
      set({ selection: { kind: "state", layer: layerId, state: stateId } });
    },
    setMarkers: (layerId, stateId, markers) => {
      /* Markers live where the runtime reads them: on the shared timeline when the state
         references one, on the state itself otherwise (`withMarkers` owns that rule). */
      apply((definition) => withMarkers(definition, layerId, stateId, markers));
    },
  };
});

/** The structure hash of the current draft, for the rebuild banner's "changed shape" rule. */
export function currentStructure(): string {
  return structuralHash(useEditorStore.getState().definition);
}
