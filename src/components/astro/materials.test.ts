import { Color, OrthographicCamera, PerspectiveCamera } from "three";
import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_PALETTE } from "../../lib/astro/astroV2.ts";
import { bodyVertexShader, eyeFragmentShader, eyeUniforms, haloVertexShader } from "./materials.ts";

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
  /* sRGB-encoded channels, which is the space the fragment shader's output is blended in
     (`colorspace_fragment` runs before the blend). */
  const channels = (c: Color) => [c.r, c.g, c.b] as const;
  const luminance = ([r, g, b]: readonly [number, number, number]) =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;

  it("is translucent, and the plate is not", () => {
    /* "43% opacity only on the side": the alpha splits on the same `isPlate` step as the
       colour, in the one draw call — the wall composites against the body, the cream
       eye does not. */
    expect(eyeUniforms.uWallOpacity.value).toBe(0.43);
    expect(eyeUniforms.uOpacity.value).toBe(1);

    expect(eyeFragmentShader).toContain("mix(uWallOpacity, uOpacity, isPlate)");
    expect(eyeFragmentShader).not.toContain("vec4(col, uOpacity)");
  });

  it("composites darker than the body it sits on", () => {
    /* The rule the wall has to obey, now that it is a tint rather than a solid: at 43% over
       the body's darkest stop the result must still read as the inside of a hole. */
    const wall = channels(eyeUniforms.uInner.value);
    const body = channels(new Color(ASTRO_V2_PALETTE.bottom));
    const alpha = eyeUniforms.uWallOpacity.value;

    const blend = (c: number, i: number) => alpha * c + (1 - alpha) * body[i]!;
    const composite: readonly [number, number, number] = [
      blend(wall[0], 0),
      blend(wall[1], 1),
      blend(wall[2], 2),
    ];
    expect(luminance(composite)).toBeLessThan(luminance(body));
  });
});
