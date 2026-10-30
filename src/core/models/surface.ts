/**
 * The vocabulary for "a React page used as a texture".
 *
 * Pure TypeScript, like everything in `core/`: no `three`, no `react-dom`, no
 * `HTMLElement`. A surface is described by its id, the Theatre.js object its texture
 * is mapped onto, and the CSS-pixel box it is laid out in. The rasterizer in
 * `infrastructure/surface/` reads those numbers, the page renders into a host of
 * that size, and the mesh maps the result. Nothing here knows a canvas exists.
 *
 * The size is part of the model, not a detail of the host's CSS, because it is the
 * number the pointer math needs: a raycast hands back a UV, and a UV becomes a page
 * pixel only once you know how wide the page is.
 */

/** Every page the `/surface` scene rasterizes. */
export const SURFACE_IDS = ["square", "sphere"] as const;

export type SurfaceId = (typeof SURFACE_IDS)[number];

/**
 * One surface: its host box, and the object its texture is mapped onto.
 *
 * `theatreKey` is the same string the mesh passes to `editable.mesh`, so the
 * outliner entry, the raycast target and the page's readout cannot disagree — the
 * project's rule for every other node, applied to a node whose geometry is a page.
 *
 * `width`/`height` are CSS pixels of the host element. The square is square because
 * a plane's UVs are 1:1 and a non-square page on a square plane is a page stretched
 * by a factor nobody notices. The sphere is 2:1 because a sphere's UV sweeps the
 * texture around the full circumference horizontally and only pole-to-pole
 * vertically: a square page on a sphere is squeezed into the middle band of the
 * visible side, and its buttons land near the poles.
 */
export type SurfaceSpec = {
  id: SurfaceId;
  label: string;
  theatreKey: string;
  width: number;
  height: number;
};

export const SURFACE_SPECS: Record<SurfaceId, SurfaceSpec> = {
  square: {
    id: "square",
    label: "Square page",
    theatreKey: "Surface Plane",
    width: 512,
    height: 512,
  },
  sphere: {
    id: "sphere",
    label: "Sphere page",
    theatreKey: "Surface Sphere",
    width: 640,
    height: 320,
  },
};

/** The surface a `theatreKey` belongs to, or `null` for a key that is not one. */
export function surfaceForTheatreKey(key: string | null): SurfaceId | null {
  if (key == null) return null;
  for (const id of SURFACE_IDS) {
    if (SURFACE_SPECS[id].theatreKey === key) return id;
  }
  return null;
}

/** Runtime guard for a surface id arriving from a `data-` attribute. */
export function isSurfaceId(value: unknown): value is SurfaceId {
  return (SURFACE_IDS as readonly unknown[]).includes(value);
}

/**
 * Where a surface page's content sits on the sphere it is wrapped around.
 *
 * `SphereGeometry` pushes `1 - u` as the UV, so the texture's `u = 0.75` lands on
 * the +Z side of the sphere — the side the camera sees. A page laid out from its
 * left edge therefore has its middle at `u = 0.5`, which is +X: a quarter turn away
 * from the reader. Rotating the mesh −π/2 about Y brings `u = 0.5` to +Z, so the
 * page reads face-on and its buttons are the ones facing the camera.
 */
export const SPHERE_SURFACE_ROTATION_Y = -Math.PI / 2;
