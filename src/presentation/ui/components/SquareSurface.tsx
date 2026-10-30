import { LOOP_ROW_HEIGHT, LOOP_ROWS, SPHERE_COLORS } from "@core/usecases/surfaceInteraction.ts";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";
import { SurfaceLoop } from "@presentation/ui/components/SurfaceLoop.tsx";
import { pressSurfaceFromPage } from "./surfacePress.ts";

/**
 * The square page — the content of the 512×512 texture mapped on `Surface Plane`.
 *
 * A flat plane takes the texture 1:1, so this page is square and its CSS sizes are the
 * texture's pixel sizes. Three rules apply to every surface page:
 *
 * - No clock, no playhead, no animation. The host is watched by a `MutationObserver`,
 *   and one mutation is a style walk, a raster, an image decode and a ~1 MB texture
 *   upload. A ticking element inside a texture is a raster per frame.
 * - No `backdrop-filter` (html2canvas renders it as nothing), no external images (never
 *   load), no CSS custom properties (the inlined clone carries computed styles only).
 * - Type and hit targets are sized for a texture that is then shrunk to fit a mesh, so
 *   anything a user is meant to press is at least 44 px on a 512 px page.
 *
 * The paint button is the one that moves the *other* object: it writes the colour sphere's
 * colour through the store, and the sphere repaints without a raster, because nothing in
 * the texture changed.
 *
 * The list loops, and the page owns that translation — see `SurfaceLoop`.
 */
export function SquareSurface() {
  const color = useSurfaceStore((state) => state.sphereColor);

  const rows: string[] = [];
  for (let index = 0; index < LOOP_ROWS; index += 1) {
    rows.push(`row ${index + 1} · scroll to loop`);
  }

  return (
    <div className="surface-page surface-page--square">
      <p className="surface-page__eyebrow">square page · html2canvas texture</p>

      <h2 className="surface-page__title">Paint the sphere</h2>

      <div className="surface-page__row">
        {SPHERE_COLORS.map((swatch) => (
          <span
            key={swatch}
            className="surface-page__swatch"
            style={{ background: swatch }}
            aria-hidden={true}
          />
        ))}
      </div>

      <button
        type="button"
        className="surface-page__btn surface-page__btn--accent"
        data-surface-action="paint-sphere"
        onClick={() => pressSurfaceFromPage("paint-sphere")}
      >
        Paint the sphere
      </button>

      {/** The square page keeps a fixed page with a looping list inside it — the whole
          page loop is the sphere's, where the request was that the button travel. */}
      <SurfaceLoop surfaceId="square">
        <ul className="surface-loop__rows">
          {rows.map((text, index) => (
            <li
              className="surface-loop__row"
              key={index}
              style={{ height: `${LOOP_ROW_HEIGHT}px` }}
            >
              {text}
            </li>
          ))}
        </ul>
      </SurfaceLoop>

      <p className="surface-page__note">{`colour sphere ${color}`}</p>
    </div>
  );
}
