/**
 * The eye prism: an oval slab, built once, with two morph targets baked in.
 *
 * Why a prism and not a sphere: the stylesheet's eye is a flat *shape* — a tall oval
 * capsule — and the look the sheet implies is a hole cut into the body, not a ball
 * sitting on it. A prism with a shaded interior reads as a well; an ellipsoid reads
 * as a bead. `three`'s `CylinderGeometry` rotated onto the z axis is an elliptical
 * prism once the mesh is scaled, and its flat caps are exactly the interior wall the
 * eye shader colours.
 *
 * ## Why custom morph attributes, not `geometry.morphAttributes`
 *
 * Three's built-in morph targets are wired through the renderer: `Mesh` allocates
 * `morphTargetInfluences` and the program emits `USE_MORPHTARGETS` from the
 * geometry, which a `ShaderMaterial` only sees if its own GLSL includes the
 * `morphtarget_*` chunks. That works, but it makes the blend depend on the renderer's
 * bookkeeping and on three's chunk names — and the blend is the thing the page
 * animates. Two plain `vec3` attributes (`aHappy`, `aSleepy`) plus one uniform each
 * do the same arithmetic explicitly, keep the weights under our control, and cannot
 * silently stop applying when three renames a chunk. The shapes are target positions
 * minus rest positions, computed here once.
 */

import { BufferAttribute, CylinderGeometry } from "three";

/** Segments around the oval. 64 is smooth at the size the eyes are ever drawn. */
const RADIAL_SEGMENTS = 64;

/**
 * The crescent target, in the geometry's unit space.
 *
 * The prism is a unit cylinder: `x, y` on the unit circle, `z ∈ [-0.5, 0.5]`. So the
 * shapes are functions of the outline alone. `happy` lifts the middle into an arch
 * (`∩`), shrinks the height and widens slightly; the arch term is symmetric in `x`,
 * which is what lets the same geometry serve both eyes.
 */
function happyTarget(x: number, y: number): [number, number] {
  return [x * 1.06, 0.45 * y + 0.5 * (1 - x * x) - 0.15];
}

/** The dash target: the sheet's asleep eye is `90 × 28.7`, i.e. a fifth of the height. */
function sleepyTarget(x: number, y: number): [number, number] {
  return [x * 1.02, 0.14 * y];
}

export type EyeGeometry = CylinderGeometry;

/**
 * The eye geometry, shared by both eyes.
 *
 * One instance, not one per eye: the two prisms are identical, the morphs are
 * symmetric, and a second buffer on the GPU for a mirror image that does not exist
 * buys nothing. A `ShaderMaterial` reads the attributes from the geometry, so the
 * two meshes cannot disagree about the shapes.
 */
export const eyeGeometry: EyeGeometry = createEyeGeometry();

function createEyeGeometry(): EyeGeometry {
  const geometry = new CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1, false);
  // CylinderGeometry's axis is y; the eyes are prisms along the view axis, so the
  // axis becomes z. `rotateX` bakes it into the buffer, so the materials' `normal`
  // attribute is already in the orientation the shader expects.
  geometry.rotateX(Math.PI / 2);

  const position = geometry.getAttribute("position");
  const happy = new Float32Array(position.count * 3);
  const sleepy = new Float32Array(position.count * 3);

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);

    const [happyX, happyY] = happyTarget(x, y);
    const [sleepyX, sleepyY] = sleepyTarget(x, y);

    happy[index * 3] = happyX - x;
    happy[index * 3 + 1] = happyY - y;
    happy[index * 3 + 2] = 0;

    sleepy[index * 3] = sleepyX - x;
    sleepy[index * 3 + 1] = sleepyY - y;
    sleepy[index * 3 + 2] = 0;
  }

  geometry.setAttribute("aHappy", new BufferAttribute(happy, 3));
  geometry.setAttribute("aSleepy", new BufferAttribute(sleepy, 3));

  return geometry;
}
