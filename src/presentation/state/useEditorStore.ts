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
const DRAFT_KEY = `astro.editor.${MACHINE_ID}.draft`;
const FILE_KEY = `astro.editor.${MACHINE_ID}.file`;

/** Where the dev-only middleware lives (§4.3). A build has no such endpoint. */
const EDITOR_ENDPOINT = "/__astro-editor";

interface EditorStore {
  machineId: string;
  definition: MachineDefinition;
  file: EditorFile;
  past: MachineDefinition[];
  future: MachineDefinition[];
  dirty: boolean;
  /* Read-only: which definition is open. Not the same as `dirty` — a Studio save is clean. */
  source: "shipped" | "local";
  error: string | null;
  status: string;

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
  const draft = readJson<{ definition?: unknown }>(DRAFT_KEY)?.definition;
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
    writeJson(DRAFT_KEY, { definition, at: Date.now() });
  };

  return {
    machineId: MACHINE_ID,
    definition: initial.definition,
    file: storedFile ?? { ...EMPTY_EDITOR_FILE, machineId: MACHINE_ID },
    past: [],
    future: [],
    dirty: initial.dirty,
    source: initial.source,
    error: null,
    status: "",

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
      if (typeof localStorage !== "undefined") localStorage.removeItem(DRAFT_KEY);
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
        if (typeof localStorage !== "undefined") localStorage.removeItem(DRAFT_KEY);
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
