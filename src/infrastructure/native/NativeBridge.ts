import { Capacitor } from "@capacitor/core";

/**
 * Capability probe for native plugins.
 *
 * A Capacitor plugin is two half-depends: a JS package and a native class in the
 * iOS/Android project. Importing the JS half of a plugin whose native half is
 * absent does not fail at build time — it fails at call time, with an opaque
 * "not implemented" rejection. `isPluginAvailable` is the check that turns that
 * into a decision the app can make up front.
 *
 * The native directories are not part of this refactor, so every native feature
 * here is capability-gated and degrades to a web fallback (or to nothing) rather
 * than adding a plugin the shells do not have installed.
 */
export function pluginAvailable(name: string): boolean {
  try {
    return Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}
