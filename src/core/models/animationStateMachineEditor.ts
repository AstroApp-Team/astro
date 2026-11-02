/**
 * The editor's own data.
 *
 * Nothing here is read by the runtime. A `MachineDefinition` is the machine; this file is the
 * workspace around it — where the cards sit, which one is selected, how wide the sidebar is —
 * and the split is deliberate: the editor may lose its layout without changing behaviour, and
 * a definition must stay loadable with every UI field absent.
 *
 * The one rule that keeps it that way: **the runtime schema never grows a UI field**. A node
 * position is not part of a machine, so it lives in `<id>.machine.editor.json` (§4.4) and is
 * git-ignored, because a merge conflict over `{x, y}` is not worth a review.
 */

import type { MachineDefinition } from "@core/models/animationStateMachine.ts";

/** Where one card sits, in graph-space pixels. */
export interface NodePoint {
  x: number;
  y: number;
}

/** The editor file, as written to `<id>.machine.editor.json`. */
export interface EditorFile {
  version: 1;
  machineId: string;
  layout: {
    /** Key is `"<layer>/<state>"`, the same key the graph uses. */
    nodes: Record<string, NodePoint>;
    /** Keys are `"<layer>/__entry"`, `"…/__any"`, `"…/__exit"`. */
    systemNodes: Record<string, NodePoint>;
    zoom: number;
    pan: NodePoint;
  };
  debug: { solo: string[]; mute: string[]; selectedLayer: string | null };
  collapsed: { timelines: boolean; machines: boolean };
  splits: { viewport: number; sidebar: number; inspector: number };
}

/** A fresh editor file — every number here is also a splitter's default (§2). */
export const EMPTY_EDITOR_FILE: EditorFile = {
  version: 1,
  machineId: "",
  layout: { nodes: {}, systemNodes: {}, zoom: 1, pan: { x: 0, y: 0 } },
  debug: { solo: [], mute: [], selectedLayer: null },
  collapsed: { timelines: false, machines: true },
  splits: { viewport: 0.45, sidebar: 280, inspector: 340 },
};

/**
 * One selection, one kind (§3).
 *
 * `index` exists because a layer may hold several transitions between the same pair —
 * `from`/`to` are not unique in `LayerDef.transitions` — so a selection that named only the
 * pair would always edit the first one.
 */
export type Selection =
  | { kind: "state"; layer: string; state: string }
  | { kind: "transition"; layer: string; from: string; to: string; index: number }
  | { kind: "layer"; layer: string }
  | { kind: "input"; name: string }
  | { kind: "listener"; index: number }
  | { kind: "timeline"; clipId: string }
  | null;

/** Which of the three stage modes the workspace is in (§2). */
export type StageMode = "graph" | "timeline" | "split";

/** The viewport's ownership badge, and the reason both modes cannot be trusted together (§10.4). */
export type ViewportMode = "machine" | "preview" | "stopped";

/** Which zone owns the keyboard (§2). */
export type EditorFocus = "viewport" | "sidebar" | "stage" | "inspector";

/** What the header shows while a structural edit rebuilds the playing machine (§4.5). */
export type RebuildNotice = null | { reason: string };

/**
 * Everything the editor file does not store: per-session comfort.
 *
 * Split sizes and node positions are in `EditorFile` because they are worth keeping across a
 * reload; hover, marquee, the filter box, the current preview clip and the play state are
 * not, because a stale `playing` would start a machine nobody pressed play on.
 */
export interface EditorSession {
  mode: StageMode;
  focus: EditorFocus;
  selection: Selection;
  /** Node drag in progress: positions live here until the pointer is released (§10). */
  dragging: Record<string, NodePoint> | null;
  hovered: Selection;
  filter: string;
  /** `null` when the stage is a graph; a clip id when previewing one. */
  previewClip: string | null;
  playing: boolean;
  /** Show the read-only table alternative to the canvas (§12). */
  table: boolean;
  /** `blocked` flashes, keyed by node key, cleared by a timer. */
  flashes: Record<string, "blocked" | "marker">;
  rebuild: RebuildNotice;
}

/** The draft, its undo stack, and what the loader thinks of it. */
export interface EditorDocState {
  machineId: string;
  definition: MachineDefinition;
  dirty: boolean;
  /** Snapshots, oldest first. The last entry is the current definition's parent. */
  past: MachineDefinition[];
  future: MachineDefinition[];
  /** Identity of the structural shape, for the "rebuild while playing" rule (§4.5). */
  structure: string;
  error: string | null;
  status: string;
}
