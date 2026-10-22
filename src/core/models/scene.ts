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
  "sting",
  "studio-sandbox",
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

/**
 * Runtime guard for a scene id that arrives from outside the type system.
 *
 * Route params are `string | undefined`; `/rig/:sceneId` will happily hand over
 * `"../../x"`. Checking it here, next to the array it checks, keeps the cast out
 * of the page that reads it.
 */
export function isSceneId(value: unknown): value is SceneId {
  return (SCENE_IDS as readonly unknown[]).includes(value);
}

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

/**
 * The example rig: a four-second "sting" that rises a ring of prefabs while the
 * camera arcs back and the key light swings.
 *
 * The JSX below carries each node's final `x`/`z`; the exported state animates
 * only `position.y`, `scale` and `rotation.y`. That split is deliberate — code
 * owns the layout, the Studio owns the motion, and the two cannot fight over the
 * same channel.
 */
export const STING_NODES: SceneNode[] = [
  { theatreKey: "Sting-Core", label: "Core", status: "active", position: [0, 0.7, 0] },
  { theatreKey: "Sting-Sat-1", label: "Voice", status: "idle", position: [3, 0.7, 0] },
  { theatreKey: "Sting-Sat-2", label: "Archive", status: "idle", position: [1.5, 0.7, -2.6] },
  { theatreKey: "Sting-Sat-3", label: "Infra", status: "idle", position: [-1.5, 0.7, -2.6] },
  { theatreKey: "Sting-Sat-4", label: "Journey", status: "idle", position: [-3, 0.7, 0] },
];

/** Where the sting's camera starts; the rig arcs from here to the wide shot. */
export const STING_CAMERA: { position: Vec3; fov: number } = {
  position: [0, 1.6, 6.5],
  fov: 62,
};

/**
 * The sting's autoplay range.
 *
 * A module constant on purpose: `useSheetPlayback` puts it in an effect's
 * dependency list, and an array literal in a component body is a new array every
 * render, which restarts the clip on every render.
 */
export const STING_AUTOPLAY: [from: number, to: number] = [0, 4];

/** The three sample prefabs the sandbox auto-populates the outliner with. */
export const SANDBOX_NODES: SceneNode[] = [
  { theatreKey: "Prefab-Node-1", label: "Node 1", status: "idle", position: [-3, 0.5, 0] },
  { theatreKey: "Prefab-Node-2", label: "Node 2", status: "active", position: [0, 0.5, 0] },
  { theatreKey: "Prefab-Node-3", label: "Node 3", status: "idle", position: [3, 0.5, 0] },
];
