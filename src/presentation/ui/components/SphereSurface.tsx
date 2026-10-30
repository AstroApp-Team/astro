import {
  describeAction,
  LOOP_HEADER_HEIGHT,
  LOOP_ROW_HEIGHT,
  LOOP_ROWS,
  LOOP_TILE_HEIGHT,
  type SurfaceActionRow,
} from "@core/usecases/surfaceInteraction.ts";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";
import { SurfaceLoop } from "@presentation/ui/components/SurfaceLoop.tsx";
import { pressSurfaceFromPage } from "./surfacePress.ts";

/**
 * The sphere page — the content of the 640×320 texture wrapped on `Surface Sphere`.
 *
 * 2:1, not square: a sphere's UV sweeps the texture around the full circumference
 * horizontally and only pole-to-pole vertically, so a square page on a sphere is
 * squeezed into the middle band of the visible side and its buttons end up near the
 * poles. Wide and short is the shape the wrapping actually shows.
 *
 * **The whole page is the loop tile.** The heading, the spin button, the copy and the
 * rows all live inside `SurfaceLoop`, so scrolling carries the button off the top and
 * brings it back at the bottom. A fixed header with a looping list inside it loops a
 * list and parks the button; the user asked for the page to loop, and a page whose
 * button never moves is not looping.
 *
 * That makes the button a moving raycast target, which is fine and is the point: its
 * rect is measured from `getBoundingClientRect` at raster time, so it travels with the
 * translation, and a tap on a part of the texture where the button is not drawn hits
 * nothing. The duplicate tile is `aria-hidden` and publishes no rect — see `SurfaceLoop`.
 *
 * Same texture rules as `SquareSurface` — no clock, no `backdrop-filter`, no images,
 * big type. The spin button is the one that moves the *other* object: it records a
 * request, and the page turns the square plane once.
 */
export function SphereSurface() {
  const log = useSurfaceStore((state) => state.log);
  const offset = useSurfaceStore((state) => state.scroll.sphere);

  const rows: string[] = [];
  for (let index = 0; index < LOOP_ROWS; index += 1) {
    rows.push(describeRow(log.rows[index], index));
  }

  return (
    <div className="surface-page surface-page--sphere">
      <SurfaceLoop surfaceId="sphere">
        <p className="surface-page__eyebrow">
          {`sphere page · scroll ${offset.toFixed(0)} / ${LOOP_TILE_HEIGHT}px`}
        </p>

        <h2 className="surface-page__title">Spin the square page</h2>

        <div className="surface-loop__head" style={{ height: `${LOOP_HEADER_HEIGHT}px` }}>
          <button
            type="button"
            className="surface-page__btn surface-page__btn--accent"
            data-surface-action="spin-square"
            onClick={() => pressSurfaceFromPage("spin-square")}
          >
            Spin once, slowly
          </button>
          <p className="surface-page__hint">
            The button is part of the page, so it scrolls away with the page. Scroll until it is on
            the sphere, then tap it.
          </p>
        </div>

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
    </div>
  );
}

/**
 * One row of the loop.
 *
 * The log runs out; the loop must not. A row past the end of the log is a filler that
 * says what it is, so the tile is always full and a reader can watch the loop wrap
 * rather than watch a list stop.
 */
function describeRow(row: SurfaceActionRow | undefined, index: number): string {
  if (row == null) return `row ${index + 1} · scroll to loop`;
  return `${describeAction(row.action)} · ${row.source}`;
}
