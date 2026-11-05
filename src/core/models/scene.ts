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
  "float",
  "astro",
  "astro-v2",
  "surface",
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
  | "sequence-played"
  /** A press that reached a mesh and passed its press gate. Carries the node's key. */
  | "node-pressed";

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

/**
 * The reverse demonstration: one sphere, no floor, no background.
 *
 * `position` here is Theatre's *initial* value — the exported `FloatScene` rig
 * keyframes `position.xyz`, so the number below is the centre of the orbit, not
 * where the sphere is drawn. It is in the array because the outliner entry, the
 * raycast target and the page's readout all read the same `theatreKey`, and a node
 * the Studio can rig has to be a node the app knows about.
 */
export const FLOAT_NODES: SceneNode[] = [
  { theatreKey: "Float Sphere", label: "Sphere", status: "active", position: [0, 1.6, 0] },
];

/**
 * Framing for the float scene.
 *
 * The sphere orbits in the XZ plane at y ≈ 1.6 with radius 2.2, so the camera sits
 * on +Z at the same height and looks straight down −Z: the orbit reads as a circle
 * and the sphere crosses the full width of the viewport. A tilted camera puts half
 * the orbit behind the page's header, and the page cannot scroll the sphere back.
 */
export const FLOAT_CAMERA: { position: Vec3; fov: number } = {
  position: [0, 1.6, 7.5],
  fov: 45,
};

/**
 * The float scene's loop: one six-second circuit.
 *
 * A module constant for the usual reason (`useSheetPlayback`'s effect dependency),
 * and one more: the page seeks the playhead to a random point inside this range
 * when the sphere is tapped, so this range *is* the set of positions the sphere can
 * be moved to. Widen it in the Studio and the taps scatter further.
 */
export const FLOAT_AUTOPLAY: [from: number, to: number] = [0, 6];

/**
 * Astro's node: one plane, painted with the character.
 *
 * The character is a flat vector drawing rather than a mesh — see
 * `infrastructure/astro/astroTexture.ts` — so the one editable object is the
 * plane the texture is mapped onto, and its `theatreKey` is the id the page, the
 * outliner and the raycast target all share.
 *
 * `position` is Theatre's *initial* value; the landed `AstroScene` rig keyframes
 * `position.xyz` into a slow drift, so the number below is the drift's centre.
 */
export const ASTRO_NODES: SceneNode[] = [
  { theatreKey: "Astro", label: "Astro", status: "active", position: [0, 1.6, 0] },
];

/**
 * Framing for the astro scene: the float camera, because the character's size was
 * measured against it.
 *
 * `astroTexture.ts` pins the body at `1.1` world units so that at `fov 45`, `z 7.5`
 * it is ~120 px of body on a 390×688 phone — the reference size the style guide
 * names. Moving this camera rescales the only number that was measured, so the
 * two files have to change together.
 */
export const ASTRO_CAMERA: { position: Vec3; fov: number } = {
  position: [0, 1.6, 7.5],
  fov: 45,
};

/**
 * Astro v2's editable object: the whole character, one group.
 *
 * One node, not one per part — the body, the two eye prisms and the halo shell are
 * children of it, so the rig animates *Astro* rather than keeping four tracks in
 * sync. `theatreKey` is the group's, and `"Astro V2"` cannot collide with v1's
 * `"Astro"`: both sheets hold one object and neither can see the other's.
 *
 * `position` is Theatre's initial value. There is no landed clip for v2 yet, so the
 * character stands still where JSX puts it and the *shaders* supply the motion — the
 * wave, the hue rotation, the breathing scale. That is deliberate: the look had to be
 * fitted first, and a clip baked before the look would have to be re-rigged after.
 * `pnpm run theatre:state -- import <export> --to AstroV2Scene` lands one later.
 */
export const ASTRO_V2_NODES: SceneNode[] = [
  { theatreKey: "Astro V2", label: "Astro V2", status: "active", position: [0, 1.6, 0] },
];

/**
 * Astro v2's framing: v1's camera exactly.
 *
 * The body is sized from `astro.ts`'s `1.1` world units, which was measured against
 * this lens, so sharing the camera is what makes the two versions the same size on
 * screen and their screenshots diffable.
 */
export const ASTRO_V2_CAMERA: { position: Vec3; fov: number } = {
  position: ASTRO_CAMERA.position,
  fov: ASTRO_CAMERA.fov,
};

/**
 * The astro scene's drift: a slow eight-second loop.
 *
 * A module constant for the usual reason (`useSheetPlayback`'s effect dependency),
 * and one more: the page seeks inside this range when the character is tapped, so
 * this range is the set of places the character can be moved to. Slower than the
 * float circuit on purpose — the character is calm, and `05-motion.md` forbids a
 * bouncy one.
 */
export const ASTRO_AUTOPLAY: [from: number, to: number] = [0, 8];

/**
 * Astro v2's loop: the same eight seconds, on its own sheet.
 *
 * A module constant for the usual reason — it is a `useSheetPlayback` effect
 * dependency — and one more: the page seeks inside this range, so this range is the set
 * of playhead positions the page can move to. Nothing is keyframed on `AstroV2Scene`
 * yet, so today it only sets the sequence's length; landing a clip makes it a real loop
 * without the page changing.
 */
export const ASTRO_V2_AUTOPLAY: [from: number, to: number] = [0, 8];

/**
 * The `/surface` scene's objects: two pages and the sphere one of them paints.
 *
 * `position` is Theatre's initial value for each. Only one prop is keyframed in
 * the rig — `Surface Plane.rotation.y`, the spin — so the plane's JSX rotation is
 * its resting orientation, not an animated one.
 *
 * The plane is 2.2 units on a side and the sphere is 1.5 across, so at 3.5 units
 * apart the two pages do not overlap from the camera: a raycast that hits both
 * reports the nearer one, and a page half behind the other is a page whose buttons
 * cannot be pressed.
 */
/** The node whose colour is app state, not a rig property. */
export const COLOUR_SPHERE_KEY = "Colour Sphere";

export const SURFACE_NODES: SceneNode[] = [
  { theatreKey: "Surface Plane", label: "Square page", status: "active", position: [-1.8, 1.5, 0] },
  { theatreKey: "Surface Sphere", label: "Sphere page", status: "active", position: [1.8, 1.5, 0] },
  {
    theatreKey: COLOUR_SPHERE_KEY,
    label: "Colour sphere",
    status: "idle",
    position: [0, 0.15, 1.7],
  },
];

/**
 * Framing for the surface scene.
 *
 * Far enough back that both pages are fully inside the viewport: a page clipped by
 * the frame is a page whose buttons cannot be pressed, and the raycast will happily
 * report a UV for a pixel that is off screen. fov 52 on a 390×688 phone puts the
 * 2.2-unit plane and the 1.5-unit sphere side by side with room at the edges.
 */
export const SURFACE_CAMERA: { position: Vec3; fov: number } = {
  position: [0, 1.5, 7.2],
  fov: 52,
};

/**
 * The spin: one slow turn of the square page, 0 → 2π over three seconds.
 *
 * A module constant for the usual reason (it is an effect dependency and a
 * `sequence.play` range) and one more: the rig's keyframes are authored for exactly
 * this window, so this range *is* the spin. Change it without re-landing the rig
 * and the button seeks to a playhead the clip does not cover.
 */
export const SPIN_RANGE: [from: number, to: number] = [0, 3];

/** One full turn, in radians. The rig keyframes `rotation.y` to this at t = 3. */
export const SPIN_ANGLE = Math.PI * 2;

/** The three sample prefabs the sandbox auto-populates the outliner with. */
export const SANDBOX_NODES: SceneNode[] = [
  { theatreKey: "Prefab-Node-1", label: "Node 1", status: "idle", position: [-3, 0.5, 0] },
  { theatreKey: "Prefab-Node-2", label: "Node 2", status: "active", position: [0, 0.5, 0] },
  { theatreKey: "Prefab-Node-3", label: "Node 3", status: "idle", position: [3, 0.5, 0] },
];

/**
 * Every scene's objects, keyed by id — the rig editor's hierarchy.
 *
 * The per-scene arrays above pre-date a page that needs *any* scene's objects at once, and the
 * alternative (a switch in the view) is a second place to forget when a scene is added: the
 * registry has `SCENE_COMPONENTS`, this project has `SCENE_SHEET_IDS`, and a hierarchy that
 * silently shows nothing for a new scene is exactly the failure the sheet map exists to prevent.
 * Typing it `Record<SceneId, …>` makes the omission a compile error instead.
 */
export const SCENE_NODES: Record<SceneId, SceneNode[]> = {
  hub: [],
  "infra-map": [],
  "career-journey": [],
  archive: [],
  sting: STING_NODES,
  float: FLOAT_NODES,
  astro: ASTRO_NODES,
  "astro-v2": ASTRO_V2_NODES,
  surface: SURFACE_NODES,
  "studio-sandbox": SANDBOX_NODES,
};
