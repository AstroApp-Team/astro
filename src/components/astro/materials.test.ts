import { Color } from "three";
import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_PALETTE, ASTRO_V2_TUNABLES } from "../../lib/astro/astroV2.ts";
import {
  applyTunables,
  bodyFragmentShader,
  bodyUniforms,
  bodyVertexShader,
  eyeFragmentShader,
  eyeUniforms,
  haloFragmentShader,
  haloReach,
  haloUniforms,
  haloVertexShader,
} from "./materials.ts";

/**
 * The body and the halo are painted in the screen plane. A colour that reads depth — a
 * `z`, a normal, a facing angle — paints the sphere's curvature onto him, which is what
 * made him read as a lit 3D ball next to astroapp.com.br's flat drawing. The *geometry*
 * stays 3D (the eyes sit in wells on a sphere); only the paint is flat.
 */
describe("body and halo paint", () => {
  const programs = {
    bodyVertexShader,
    bodyFragmentShader,
    haloVertexShader,
    haloFragmentShader,
  };

  for (const [name, source] of Object.entries(programs)) {
    it(`${name} reads only x and y`, () => {
      expect(source).not.toMatch(
        /\.z\b|\.xyz\b|\bnormal\b|normalMatrix|viewDirection|cameraPosition/,
      );
    });
  }

  it("blends the body's stops linearly, as the drawing does", () => {
    expect(bodyFragmentShader).not.toContain("smoothstep(0.0, uStopMid");
  });

  it("never paints the amber the halo glows in, whatever the wave does", () => {
    /* The halo's inner colour is the ramp's top stop. The body's ramp starts below it, and
       that remap comes after every term that moves the coordinate, so no wave or drift can
       push his edge into the glow's colour. */
    applyTunables(ASTRO_V2_TUNABLES);
    expect(ASTRO_V2_PALETTE.haloInner).toBe(ASTRO_V2_PALETTE.top);
    expect(bodyUniforms.uRampStart.value).toBeGreaterThan(0.15);

    const remap = bodyFragmentShader.indexOf("t = mix(uRampStart, 1.0, t);");
    expect(remap).toBeGreaterThan(-1);
    expect(bodyFragmentShader.lastIndexOf("t = ")).toBe(remap);
  });
});

describe("the halo", () => {
  it("is drawn on a quad big enough for its widest breath at full voice", () => {
    applyTunables(ASTRO_V2_TUNABLES);
    const t = ASTRO_V2_TUNABLES;
    const widest =
      t.haloEdgeStart +
      (t.haloSize - t.haloEdgeStart) * (1 + t.haloPulseAmount) * (1 + t.haloSpeechReach);
    expect(haloReach(t)).toBeGreaterThan(widest);
    expect(haloUniforms.uSize.value).toBeCloseTo(haloUniforms.uBodyRadius.value * haloReach(t), 6);
  });

  it("is bright against the body and redder outside it", () => {
    expect(haloUniforms.uColorInner.value.getHexString()).toBe("ff8b00");
    expect(haloUniforms.uColorOuter.value.getHexString()).toBe("fb5f25");
  });

  it("fades out in its own colour, never toward black", () => {
    expect(haloFragmentShader).toContain("vec4(col, min(alpha, 1.0))");
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
