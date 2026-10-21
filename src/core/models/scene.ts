/**
 * Domain model for the 3D world.
 *
 * Deliberately free of `three` and `@react-three/*` types: this is the vocabulary
 * the 2D UI and the 3D canvas share, and if it carried `Object3D` the DOM layer
 * would be importing WebGL to say "the user tapped a card".
 *
 * Positions are `[x, y, z]` tuples, which is exactly what R3F accepts for a
 * `position` prop, so the bridge needs no conversion.
 */

/** Every scene the app can put on the canvas. */
export const SCENE_IDS = [
  "hub",
  "infra-map",
  "career-journey",
  "archive",
  "studio-sandbox",
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

/** One place the camera can be asked to look at. */
export type Vec3 = [number, number, number];

/**
 * A selectable thing in the active scene.
 *
 * `theatreKey` is the identity Theatre.js uses in its outliner, so a node that
 * is animatable in the Studio and a node the UI can select are the same node —
 * one string, no mapping table to keep in sync.
 */
export type SceneNode = {
  theatreKey: string;
  label: string;
  status: string;
  position: Vec3;
};

/** What the 2D layer is told about, and can act on. */
export type SceneEventName =
  | "node-selected"
  | "node-deselected"
  | "node-focus-requested"
  | "scene-changed"
  | "sequence-played";

export type SceneEvent = { name: SceneEventName; at: number; nodeId: string | null };

/**
 * The Studio Corner's default rig: far enough back to see three prefabs on the
 * grid, high enough to read them as a floor plan.
 */
export const SANDBOX_CAMERA: { position: Vec3; fov: number } = {
  position: [0, 5, 10],
  fov: 50,
};

/** The three sample prefabs the sandbox auto-populates the outliner with. */
export const SANDBOX_NODES: SceneNode[] = [
  { theatreKey: "Prefab-Node-1", label: "Node 1", status: "idle", position: [-3, 0.5, 0] },
  { theatreKey: "Prefab-Node-2", label: "Node 2", status: "active", position: [0, 0.5, 0] },
  { theatreKey: "Prefab-Node-3", label: "Node 3", status: "idle", position: [3, 0.5, 0] },
];
