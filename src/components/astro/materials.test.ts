import { Color, OrthographicCamera, PerspectiveCamera } from "three";
import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_PALETTE } from "../../lib/astro/astroV2.ts";
import { bodyVertexShader, eyeUniforms, haloVertexShader } from "./materials.ts";

/**
 * Both programs shade by facing angle — the body's rim bloom and the halo's grazing
 * band are `dot(normal, viewDirection)` — so the ray they measure against has to be the
 * camera's, not the fragment's. `normalize(-viewPosition)` is the ray to the camera only
 * under perspective; under an orthographic camera the rays are parallel, and with the
 * character parked in a corner that expression aims at the *corner*, skewing both terms
 * toward whichever side he sits on. That was the report "the halo is pointing in the
 * wrong direction".
 */
describe("the view ray the shaders measure facing against", () => {
  it("reads the orthographic flag from a matrix element three fills that way", () => {
    const orthographic = new OrthographicCamera(-5, 5, 3, -3, 0.1, 100);
    orthographic.updateProjectionMatrix();

    const perspective = new PerspectiveCamera(45, 1.6, 0.1, 100);
    perspective.updateProjectionMatrix();

    /* GLSL's `projectionMatrix[3][3]` is element 15 (column-major, bottom-right): 1 for
       parallel rays, 0 for rays through the camera's origin. */
    expect(orthographic.projectionMatrix.elements[15]).toBe(1);
    expect(perspective.projectionMatrix.elements[15]).toBe(0);
  });

  it("asks the projection rather than assuming a camera position", () => {
    for (const shader of [bodyVertexShader, haloVertexShader]) {
      expect(shader).toContain("projectionMatrix[3][3]");
      expect(shader).toContain("viewDirection(viewPosition.xyz)");
      /* The regression this guards: the perspective-only form, which points at his corner. */
      expect(shader).not.toContain("normalize(-viewPosition.xyz)");
    }
  });
});

describe("the eye's inner wall", () => {
  /* Linear-light luminance, the space `Color` keeps when given a hex in sRGB. */
  const luminance = ({ r, g, b }: Color) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  it("is darker than every stop of the body gradient", () => {
    /* The wall is the inside of a hole, so it is in shadow. A lit wall read as a rim laid
       on the body rather than a cavity cut into it — hence "darker than the darkest astro
       colour", which is `bottom`. */
    const wall = luminance(eyeUniforms.uInner.value);

    for (const stop of [ASTRO_V2_PALETTE.top, ASTRO_V2_PALETTE.mid, ASTRO_V2_PALETTE.bottom]) {
      expect(wall).toBeLessThan(luminance(new Color(stop)));
    }
  });
});
