import { create } from "zustand";

import { SHEET_IDS, type SheetId } from "@infra/theatre/project.ts";
import { readLocalShapesSeed } from "@infra/theatre/states/index.ts";
import type { ShapeKind, SpawnedShape } from "@core/models/shapes.ts";
import {
  SHAPE_SPECS,
  SPAWN_ROTATION,
  shapeTheatreKey,
  spawnPositionFor,
  spawnScaleFor,
} from "@core/models/shapes.ts";
import type { Vec3 } from "@core/models/scene.ts";

/**
 * What "Aim Camera" did last.
 *
 * Stored as plain numbers, not as a three object: the toolbar readout, the
 * palette pane and the extension's status line all render this, and none of
 * them should need `three` to print an angle.
 */
export type AimRecord = {
  at: number;
  sheetId: SheetId;
  cameraKey: string;
  /** The outliner key of the thing aimed at, or null for a raw coordinate. */
  targetKey: string | null;
  from: Vec3;
  to: Vec3;
  /** Radians, in three's `XYZ` order — the exact values written to Theatre. */
  euler: Vec3;
  distance: number;
};

/**
 * The bucket a scene with no saved shapes renders.
 *
 * Module scope, so a selector that falls back to it returns a stable reference —
 * a fresh `[]` per render would re-render every subscriber of the store.
 */
export const EMPTY_SHAPES: SpawnedShape[] = [];

export type ShapeStore = {
  /**
   * Everything the menu has spawned, **partitioned by sheet id**, in spawn order
   * per sheet.
   *
   * One flat array used to mean a shape spawned on `/surface` rendered on every
   * route: `<SpawnedShapes />` is mounted inside every scene's `SheetProvider`,
   * and it used to read the whole list. The partition is the fix — each scene
   * renders only the bucket matching its sheet, and the toolbar spawns into the
   * active sheet (`sheetId`) on purpose.
   *
   * Keyed by plain `string`, not `SheetId`: the file is hand-editable, and a
   * bucket whose key is not a sheet this app mounts is inert (nothing renders
   * it) but must still round-trip through Save — narrowing the store to known
   * ids would silently delete it on the next save.
   */
  shapes: Record<string, SpawnedShape[]>;
  /**
   * The sheet the tools act on.
   *
   * The Studio extension lives outside the canvas, so it cannot ask R3F which
   * `SheetProvider` is mounted. The page that owns the route writes the sheet
   * here (`/studio-corner` → `StudioSandbox`, `/rig/<scene>` → that scene's
   * sheet), and the tools read it. Without this the extension would aim a
   * camera on a sheet nobody is looking at, and the write would succeed.
   */
  sheetId: SheetId;
  /** The outliner key of the camera to rotate. `TheatreCameraRig` writes it. */
  cameraKey: string;
  lastAim: AimRecord | null;
  /** Bumped by every successful aim. The camera rig uses it to drop `lookAt`. */
  aimCount: number;
  /** One-line result of the last tool action, for the readouts. */
  toolStatus: string;
  /** When the Save button last wrote the files; null until it does. */
  lastSavedAt: string | null;

  addShape(kind: ShapeKind): SpawnedShape;
  removeShape(id: string): void;
  removeLastShape(): void;
  clearShapes(): void;
  setSheetId(sheetId: SheetId): void;
  setCameraKey(cameraKey: string): void;
  setToolStatus(message: string): void;
  setLastSavedAt(at: string | null): void;
  recordAim(record: AimRecord): void;
  /**
   * The live spawn counter, not a snapshot of `shapes.length`.
   *
   * The Save button writes this number into the file. It has to be the counter
   * itself: after a delete, `length` regresses, and a reload from a regressed
   * counter reissues a `theatreKey` that is already in the sheet — two meshes,
   * one set of tracks, no error.
   */
  spawnOrdinal(): number;
};

/**
 * The spawn counter, at module scope.
 *
 * It is *not* store state: `addShape` needs the ordinal before it can build the
 * `theatreKey`, and reading it out of the array length is a bug the moment
 * someone deletes a shape — `Cube-2` would be handed out twice, and Theatre
 * would silently hand both meshes the same props, the same outliner row and the
 * same keyframes.
 *
 * It is seeded from the last Save for the same reason: a reload that restarts the
 * counter at zero hands out `Cube-0` a second time, and the two meshes land on one
 * set of tracks. The counter continuing is what makes a reload a continuation.
 */
const seed = readLocalShapesSeed();

let spawnOrdinal = seed.ordinal;

/**
 * The seed, cut into the store's per-sheet shape.
 *
 * Every bucket the file names gets a slot — including ones no scene mounts —
 * because dropping an unknown key here would be a data loss on the next Save,
 * and an inert bucket is the correct home for it until it is not.
 */
function seedBuckets(): Record<string, SpawnedShape[]> {
  const buckets: Record<string, SpawnedShape[]> = {};
  for (const [sheetId, entries] of Object.entries(seed.shapesBySheet)) {
    buckets[sheetId] = entries;
  }
  return buckets;
}

/** One number for the readout: shapes across every sheet. */
function seedShapeCount(): number {
  return Object.values(seedBuckets()).reduce((total, entries) => total + entries.length, 0);
}

/**
 * The saved sheet id, narrowed to one this app mounts.
 *
 * The file is hand-editable, so a typo is expected; falling back to the sandbox is
 * better than a store whose `sheetId` names a sheet nothing reads, because the
 * tools would then write keyframes into a sheet no scene mounts — a successful
 * write with nothing on screen.
 */
function seedSheetId(value: string): SheetId {
  const known = Object.values(SHEET_IDS) as string[];
  return known.includes(value) ? (value as SheetId) : "StudioSandbox";
}

export const useShapeStore = create<ShapeStore>((set, get) => ({
  shapes: seedBuckets(),
  sheetId: seedSheetId(seed.sheetId),
  cameraKey: seed.cameraKey,
  lastAim: null,
  aimCount: 0,
  toolStatus:
    seedShapeCount() === 0
      ? "No tool has run yet."
      : `Restored ${seedShapeCount()} saved shape${seedShapeCount() === 1 ? "" : "s"}.`,
  lastSavedAt: null,

  addShape(kind) {
    const ordinal = spawnOrdinal++;
    const spec = SHAPE_SPECS[kind];
    const shape: SpawnedShape = {
      id: `${kind}-${ordinal}`,
      kind,
      theatreKey: shapeTheatreKey(kind, ordinal),
      position: spawnPositionFor(ordinal),
      rotation: [...SPAWN_ROTATION[kind]] as Vec3,
      scale: spawnScaleFor(kind),
    };

    // The active sheet is the spawn target: the page that owns the route wrote
    // it here on mount, and the pane's Sheet select overrides it. A shape that
    // landed in the wrong bucket would be invisible on the route the user is on.
    set((state) => ({
      shapes: {
        ...state.shapes,
        [state.sheetId]: [...(state.shapes[state.sheetId] ?? EMPTY_SHAPES), shape],
      },
      toolStatus: `Spawned ${spec.label} as "${shape.theatreKey}" in ${state.sheetId}.`,
    }));

    return shape;
  },

  removeShape(id) {
    // The id is global across sheets (the ordinal in it is), so one pass over
    // every bucket finds it; a shape nobody spawned is reported, not invented.
    const { shapes } = get();
    let found = false;
    const next: Record<string, SpawnedShape[]> = {};
    for (const [sheetId, entries] of Object.entries(shapes)) {
      const kept = entries.filter((candidate) => candidate.id !== id);
      if (kept.length !== entries.length) found = true;
      next[sheetId] = kept;
    }
    if (!found) {
      set({ toolStatus: `No spawned shape with id "${id}".` });
      return;
    }
    set({ shapes: next, toolStatus: `Removed ${id}.` });
  },

  removeLastShape() {
    // "Last" means the last spawn **in the active sheet** — the toolbar acts on
    // one sheet, and a global last could delete a shape on a route the user is
    // not looking at.
    const { shapes, sheetId } = get();
    const entries = shapes[sheetId] ?? EMPTY_SHAPES;
    const last = entries[entries.length - 1];
    if (last == null) {
      set({ toolStatus: `Nothing to remove on ${sheetId}.` });
      return;
    }
    set({
      shapes: { ...shapes, [sheetId]: entries.slice(0, -1) },
      toolStatus: `Removed ${last.theatreKey}.`,
    });
  },

  clearShapes() {
    // The active sheet's bucket only: the pane is pointed at one sheet, and a
    // clear that reaches into other sheets would delete shapes on routes the
    // user has not opened.
    const { sheetId } = get();
    set((state) => ({
      shapes: { ...state.shapes, [sheetId]: [] },
      toolStatus: `Removed every spawned shape on ${sheetId}.`,
    }));
  },

  setSheetId(sheetId) {
    set({ sheetId });
  },

  setCameraKey(cameraKey) {
    set({ cameraKey });
  },

  setToolStatus(message) {
    set({ toolStatus: message });
  },

  setLastSavedAt(at) {
    set({ lastSavedAt: at });
  },

  recordAim(record) {
    set((state) => ({
      lastAim: record,
      aimCount: state.aimCount + 1,
      toolStatus: `Aimed "${record.cameraKey}" at ${record.targetKey ?? "target"} · ${record.distance.toFixed(2)}m.`,
    }));
  },

  spawnOrdinal() {
    return spawnOrdinal;
  },
}));
