/**
 * Exported Theatre.js project state.
 *
 * The Studio exports a project's animation state as JSON. Drop that file in this
 * folder, register it below, and production playback picks it up — the Studio is
 * a devDependency and never ships, so the *export* is the only thing that crosses
 * into the Capacitor bundle.
 *
 * Empty by default: a project with no state plays its props at their initial
 * values, which is exactly what a scene that has not been rigged in the Studio
 * yet should do.
 *
 * To wire up an export:
 *
 *   1. Studio → right-click the project → Export state → `studio-sandbox.state.json`
 *   2. Save it in this folder
 *   3. Add `import studioSandbox from "./studio-sandbox.state.json"` here and put
 *      it in the map below (`resolveJsonModule` is on in tsconfig.app.json)
 */

export const PROJECT_ID = "PortfolioProject";

/** Project id → the state object as exported by the Studio. */
export const projectStates: Record<string, unknown> = {};
