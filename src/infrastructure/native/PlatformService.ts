import { Capacitor } from "@capacitor/core";

import type { Platform, PlatformPort } from "@core/interfaces/nativePorts.ts";

/**
 * The one place the app asks what it is running on.
 *
 * Every Capacitor import in the app goes through `infrastructure/native/`; a
 * component that imports `@capacitor/core` directly is a component that can no
 * longer be rendered in a test, in Storybook, or on the web build.
 */

/** True inside a Capacitor WebView on iOS or Android. */
export function isNativeMobile(): boolean {
  return Capacitor.isNativePlatform();
}

export function currentPlatform(): Platform {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios" ? platform : "web";
}

/**
 * Desktop browser: the only place the Theatre.js Studio is allowed to load.
 *
 * The Studio is a full editor DOM with drag targets and keyboard shortcuts. It
 * has no touch story, and it is a devDependency, so it must never reach a phone
 * — not as a bundle, and not as a panel that covers the app.
 */
export function isDesktopBrowser(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if (typeof window === "undefined") return false;

  // Coarse pointer is the cheap, reliable signal: a phone's browser reports
  // `(hover: none) and (pointer: coarse)`, a desktop's does not. Anything the
  // media query cannot answer counts as mobile — the safe direction, because the
  // only thing this gates is a dev-only editor.
  const canTouch = window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? true;
  return !canTouch;
}

export const platformPort: PlatformPort = {
  platform: currentPlatform,
  isNative: () => Capacitor.isNativePlatform(),
};
