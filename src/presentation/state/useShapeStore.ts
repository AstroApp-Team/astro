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

export type ShapeStore = {
  /** Everything the menu has spawned, in spawn order. */
  shapes: SpawnedShape[];
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
  shapes: seed.entries,
  sheetId: seedSheetId(seed.sheetId),
  cameraKey: seed.cameraKey,
  lastAim: null,
  aimCount: 0,
  toolStatus:
    seed.entries.length === 0
      ? "No tool has run yet."
      : `Restored ${seed.entries.length} saved shape${seed.entries.length === 1 ? "" : "s"}.`,
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

    set((state) => ({
      shapes: [...state.shapes, shape],
      toolStatus: `Spawned ${spec.label} as "${shape.theatreKey}".`,
    }));

    return shape;
  },

  removeShape(id) {
    const next = get().shapes.filter((shape) => shape.id !== id);
    set({ shapes: next, toolStatus: `Removed ${id}.` });
  },

  removeLastShape() {
    const { shapes } = get();
    const last = shapes[shapes.length - 1];
    if (last == null) {
      set({ toolStatus: "Nothing to remove." });
      return;
    }
    set({ shapes: shapes.slice(0, -1), toolStatus: `Removed ${last.theatreKey}.` });
  },

  clearShapes() {
    set({ shapes: [], toolStatus: "Removed every spawned shape." });
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
