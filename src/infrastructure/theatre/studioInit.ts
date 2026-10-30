import { Capacitor } from "@capacitor/core";

import type { IStudio } from "@theatre/studio";

/**
 * Resolves the studio object out of a dynamic import of `@theatre/studio`.
 *
 * The package is CJS whose `module.exports` is `{ ToolbarDropdownSelect, default }`,
 * and the two ways this file gets loaded disagree about who is the studio:
 *
 *   - plain CJS `require()`: `mod.default` **is** the studio
 *   - Vite's pre-bundled dep (`optimizeDeps.include` in `vite.config.ts` emits
 *     `export default require_dist()`): `mod.default` is `module.exports`, so the
 *     studio is `mod.default.default`
 *
 * So `studio.default.initialize` is a function under Node and `undefined` in the
 * browser, where it throws `studio.default.initialize is not a function` and the
 * Studio panel never appears. Unwrap once, tolerate both shapes.
 */
function unwrapStudio(mod: { default: unknown }): IStudio {
  const first = mod.default as Partial<IStudio> & { default?: IStudio };
  return (first.default ?? first) as IStudio;
}

/**
 * Safe conditional loader for `@theatre/studio`.
 *
 * Three things keep this file short and non-negotiable:
 *
 *   1. `@theatre/studio` is a **devDependency**. The dynamic import sits inside
 *      the `import.meta.env.DEV` guard, so the production transform folds the
 *      whole branch away and the ~770 KB editor never reaches the Capacitor
 *      bundle. Move the import above the guard and it ships to the phone.
 *   2. It is CJS, and its default export is double-wrapped under Vite — see
 *      `unwrapStudio()`.
 *   3. The Studio is a desktop editor. On a phone it renders a panel over the
 *      app that cannot be dragged, scrubbed or dismissed with a finger, so
 *      `Capacitor.isNativePlatform()` is a hard gate, not a preference.
 */

let isStudioInitialized = false;

/** Resolved only after `initTheatreStudio()` has run; null everywhere else. */
let studioInstance: IStudio | null = null;

export async function initTheatreStudio(): Promise<void> {
  if (import.meta.env.DEV && !Capacitor.isNativePlatform() && !isStudioInitialized) {
    const mod = await import("@theatre/studio");
    const studio = unwrapStudio(mod);

    /**
     * Register the Scene Tools extension **before** `initialize()`.
     *
     * The Studio's toolbar component reads extensions out of its state atom, so a
     * late `extend()` does land — one paint of the toolbar later, with the chrome
     * already laid out without it. Registering first is what makes the buttons
     * present on the first paint.
     *
     * This import points *outward* (infrastructure → presentation), against the
     * layering rule, and it is the one place in the project that does. The
     * extension is Studio UI: its panes are React components, and React components
     * belong in `presentation/`. Keeping the import inside the same
     * `import.meta.env.DEV` guard as `@theatre/studio` is what makes the
     * inversion cheap — the production transform folds the branch away, so
     * `presentation/canvas/studio/shapeTools/` (and `react-dom/client`, and the
     * menu overlay) never reaches the phone.
     */
    const { registerSceneToolsExtension } =
      await import("@presentation/canvas/studio/shapeTools/extension.ts");
    registerSceneToolsExtension(studio);

    /**
     * `usePersistentStorage: false` — the Scene Tools Save button is the persistence.
     *
     * Theatre's own autosave writes the Studio's state to `localStorage` and
     * restores it on the next load, *after* `getProject()` has read the state file.
     * Left on, it wins every argument: a hand-edit of
     * `states/astro.local.state.json` is overwritten by the browser's snapshot the
     * moment the page reloads, so editing the file looks like it did nothing. With
     * it off, the file on disk is the only thing that survives a reload, and the
     * Save button is the thing that writes it.
     *
     * The trade is explicit: nothing is saved automatically. Rig, press Save.
     */
    studio.initialize({ usePersistentStorage: false });
    isStudioInitialized = true;
    studioInstance = studio;
  }
}

/**
 * Initialize the Studio if it is not up yet, and report whether it is usable.
 *
 * `initTheatreStudio()` is fire-and-forget from `main.tsx`, so a page that mounts
 * and immediately calls `showStudioUi()` loses the race: `studioInstance` is still
 * null, `showStudioUi()` returns false, and `#theatrejs-studio-root` stays an
 * empty fixed div. Any page that shows Studio UI awaits this first.
 *
 * Resolves null where the Studio does not exist — production, and the native
 * shell — so callers can render a disabled button instead of a dead one.
 */
export async function ensureStudio(): Promise<IStudio | null> {
  await initTheatreStudio();
  return studioInstance;
}

/** False on a phone, in production, and before the first `initTheatreStudio()`. */
export function isStudioAvailable(): boolean {
  return studioInstance != null;
}

/**
 * Show the Studio panel. No-op where the Studio was never loaded, which is the
 * entire point of the guard above.
 */
/**
 * Show the Studio panel, and report the resulting visibility.
 *
 * Returns false where the Studio was never loaded, which is the entire point of
 * the guard above. Callers keep the toolbar button label in sync from this
 * return value rather than assuming the panel appeared.
 *
 * `restore()` is the API — `IStudioUI` has `hide()`, `restore()` and `isHidden`;
 * there is no `show()`.
 */
export function showStudioUi(): boolean {
  const studio = studioInstance;
  if (studio == null) {
    return false;
  }
  studio.ui.restore();
  return !studio.ui.isHidden;
}

/** Hide the Studio panel; returns the resulting visibility. */
export function hideStudioUi(): boolean {
  const studio = studioInstance;
  if (studio == null) {
    return false;
  }
  studio.ui.hide();
  return !studio.ui.isHidden;
}
