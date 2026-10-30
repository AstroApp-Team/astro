import type { Vec3 } from "@core/models/scene.ts";

/**
 * The vocabulary for shapes the Studio extension spawns.
 *
 * Pure TypeScript, like the rest of `core/`: no `three`, no `@react-three/*`, no
 * DOM. The geometry *args* are plain number arrays, which is exactly what R3F's
 * `<boxGeometry args={…}>` takes, so the canvas layer needs no translation and
 * the Studio extension can build a shape without importing WebGL.
 *
 * Keeping the catalogue in one table means the menu, the mesh renderer and the
 * outliner label all read the same four entries — a shape nobody can spawn from
 * the menu is a shape the menu cannot forget, not a shape that renders as
 * nothing.
 */
export const SHAPE_KINDS = ["cube", "sphere", "flat-square", "flat-circle"] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Runtime guard for a kind arriving from a menu click (a `string` at the edge). */
export function isShapeKind(value: unknown): value is ShapeKind {
  return (SHAPE_KINDS as readonly unknown[]).includes(value);
}

/** Which R3F geometry a kind maps to. The canvas switches on this, once. */
export type ShapeGeometry = "box" | "sphere" | "plane" | "circle";

export type ShapeSpec = {
  kind: ShapeKind;
  /** Label in the Studio menu and the outliner. */
  label: string;
  geometry: ShapeGeometry;
  /** Args for the R3F geometry constructor, in constructor order. */
  args: number[];
  /**
   * Flat shapes are 2D planes. They get `rotation.x = -π/2` on spawn so they lie
   * on the grid rather than facing the camera, and `DoubleSide` in the material
   * so they do not vanish when the camera drops below them.
   */
  flat: boolean;
};

export const SHAPE_SPECS: Record<ShapeKind, ShapeSpec> = {
  cube: { kind: "cube", label: "Cube", geometry: "box", args: [1, 1, 1], flat: false },
  sphere: { kind: "sphere", label: "Sphere", geometry: "sphere", args: [0.7, 32, 16], flat: false },
  "flat-square": {
    kind: "flat-square",
    label: "Flat Square",
    geometry: "plane",
    args: [1.4, 1.4],
    flat: true,
  },
  "flat-circle": {
    kind: "flat-circle",
    label: "Flat Circle",
    geometry: "circle",
    args: [0.8, 48],
    flat: true,
  },
};

/** Menu order. Derived from `SHAPE_KINDS` so the two cannot disagree. */
export const SHAPE_MENU: ShapeSpec[] = SHAPE_KINDS.map((kind) => SHAPE_SPECS[kind]);

/**
 * A shape the user spawned from the menu.
 *
 * `theatreKey` is the address in the Studio outliner, and it is also the id the
 * palette row and the raycast target use — the same identity rule as
 * `SceneNode.theatreKey`. Rename it after a clip is rigged and the clip stops
 * applying, silently.
 */
export type SpawnedShape = {
  id: string;
  kind: ShapeKind;
  theatreKey: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

/**
 * The rotation a kind spawns with.
 *
 * Flat shapes are authored in the XY plane (`planeGeometry`/`circleGeometry`),
 * so with no rotation they stand upright and edge-on to a camera at eye height.
 * `-π/2` about x lays them on the XZ grid, which is what "flat" means on a
 * stage with a floor grid.
 */
export const SPAWN_ROTATION: Record<ShapeKind, Vec3> = {
  cube: [0, 0, 0],
  sphere: [0, 0, 0],
  "flat-square": [-Math.PI / 2, 0, 0],
  "flat-circle": [-Math.PI / 2, 0, 0],
};

/** Distance between spawn slots, in world units (1 unit = 1 grid cell). */
export const SPAWN_SPACING = 2.4;

/** Height above the grid a shape spawns at, so nothing intersects the floor. */
export const SPAWN_HEIGHT = 0.75;

/**
 * Spawn slot for the nth shape: a widening ring around the origin.
 *
 * Deterministic, so a spawn is reproducible and two shapes never land inside
 * each other. A ring rather than a line: the camera in the sandbox looks down
 * the +z axis, and shapes marching along x walk out of frame after four of them.
 */
export function spawnPositionFor(ordinal: number): Vec3 {
  const angle = ordinal * 0.9;
  const radius = SPAWN_SPACING * Math.sqrt(ordinal + 1);
  return [
    Math.round(Math.cos(angle) * radius * 1000) / 1000,
    SPAWN_HEIGHT,
    Math.round(Math.sin(angle) * radius * 1000) / 1000,
  ];
}

/**
 * The outliner key for a spawned shape.
 *
 * `<Kind>-<ordinal>`: the ordinal is what makes it unique inside a sheet, and
 * Theatre rejects keys shorter than four characters, which is why `Cube-0` is
 * spelled out and not `c0`.
 */
export function shapeTheatreKey(kind: ShapeKind, ordinal: number): string {
  return `${kind.replace(/(^|-)(\w)/gu, (_m, sep: string, char: string) => sep + char.toUpperCase())}-${ordinal}`;
}

/** The default scale. Flat shapes get a slightly larger footprint than cubes. */
export function spawnScaleFor(kind: ShapeKind): Vec3 {
  return SHAPE_SPECS[kind].flat ? [1.4, 1.4, 1.4] : [1, 1, 1];
}
