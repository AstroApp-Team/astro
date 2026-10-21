import { Capacitor } from "@capacitor/core";

import type { IStudio } from "@theatre/studio";

/**
 * Safe conditional loader for `@theatre/studio`.
 *
 * Three things keep this file short and non-negotiable:
 *
 *   1. `@theatre/studio` is a **devDependency**. The dynamic import sits inside
 *      the `import.meta.env.DEV` guard, so the production transform folds the
 *      whole branch away and the ~770 KB editor never reaches the Capacitor
 *      bundle. Move the import above the guard and it ships to the phone.
 *   2. It is CJS, hence `studio.default`.
 *   3. The Studio is a desktop editor. On a phone it renders a panel over the
 *      app that cannot be dragged, scrubbed or dismissed with a finger, so
 *      `Capacitor.isNativePlatform()` is a hard gate, not a preference.
 */

let isStudioInitialized = false;

/** Resolved only after `initTheatreStudio()` has run; null everywhere else. */
let studioInstance: IStudio | null = null;

export async function initTheatreStudio(): Promise<void> {
  if (import.meta.env.DEV && !Capacitor.isNativePlatform() && !isStudioInitialized) {
    const studio = await import("@theatre/studio");
    studio.default.initialize();
    isStudioInitialized = true;
    studioInstance = studio.default;
  }
}

/** False on a phone, in production, and before the first `initTheatreStudio()`. */
export function isStudioAvailable(): boolean {
  return studioInstance != null;
}

/**
 * Show the Studio panel. No-op where the Studio was never loaded, which is the
 * entire point of the guard above.
 */
export function showStudioUi(): void {
  studioInstance?.ui.restore();
}

export function hideStudioUi(): void {
  studioInstance?.ui.hide();
}
