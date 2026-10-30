import type { SurfaceAction } from "@core/usecases/surfaceInteraction.ts";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";

/**
 * A press from the real DOM: a button inside a surface page that the user can also
 * click with a finger, as opposed to the raycast that presses the same button
 * through the texture.
 *
 * Both paths call this. That is the point of the page: the same action id, the same
 * store write, the same log row — and the row records which one came through the
 * mesh, which is the only visible proof that a raycast hit a pixel and turned it
 * into a click.
 *
 * A function, not a hook: it reads the store imperatively, subscribes to nothing,
 * and is called from a click handler.
 */
export function pressSurfaceFromPage(action: SurfaceAction): void {
  const state = useSurfaceStore.getState();
  state.press({ action, source: "page", point: null, from: state.playhead });
}
