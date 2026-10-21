import { registerPlugin } from "@capacitor/core";

import type { HapticPort, HapticStyle } from "@core/interfaces/nativePorts.ts";
import { pluginAvailable } from "@infra/native/NativeBridge.ts";

/**
 * Shape of the `@capacitor/haptics` surface this service uses.
 *
 * Declared locally rather than imported: Haptics is a separate Capacitor package
 * whose *native* half has to be registered in the iOS/Android projects, and those
 * directories are out of scope here. `registerPlugin` resolves to a proxy at call
 * time, so the app can use the plugin where it is installed and skip it where it
 * is not, without a dependency the shells cannot satisfy.
 */
type HapticsPlugin = {
  impactFeedback(options: { style: "LIGHT" | "MEDIUM" | "HEAVY" | "LIGHT" }): Promise<void>;
  notificationFeedback(options: { style: "SUCCESS" | "WARNING" | "ERROR" }): Promise<void>;
};

const STYLE: Record<HapticStyle, "LIGHT" | "MEDIUM" | "HEAVY"> = {
  light: "LIGHT",
  medium: "MEDIUM",
  heavy: "HEAVY",
  selection: "LIGHT",
};

/** Millisecond pattern roughly matching the native "light impact" buzz. */
const VIBRATE_PATTERN: Record<HapticStyle, number[]> = {
  light: [10],
  medium: [20],
  heavy: [35],
  selection: [6],
};

const NOTIFICATION_PATTERN: Record<"success" | "warning" | "error", number[]> = {
  success: [12, 40, 12],
  warning: [40, 40, 40],
  error: [80],
};

const haptics: HapticsPlugin | null = pluginAvailable("Haptics")
  ? registerPlugin<HapticsPlugin>("Haptics")
  : null;

function vibrate(pattern: number[]): void {
  // Android Chrome only; iOS Safari has no vibration API at all.
  navigator.vibrate?.(pattern);
}

/**
 * Fire-and-forget by contract: a haptic that cannot run is not an application
 * error, so every path swallows. `navigator.vibrate` also throws a SecurityError
 * when the page has no user activation, which is exactly the kind of thing that
 * should never reach a voice session's error banner.
 */
export const HapticsService: HapticPort = {
  impact(style) {
    try {
      if (haptics != null) void haptics.impactFeedback({ style: STYLE[style] });
      else vibrate(VIBRATE_PATTERN[style]);
    } catch {
      /* non-fatal */
    }
  },
  notification(kind) {
    try {
      if (haptics != null)
        void haptics.notificationFeedback({ style: kind.toUpperCase() as "SUCCESS" });
      else vibrate(NOTIFICATION_PATTERN[kind]);
    } catch {
      /* non-fatal */
    }
  },
};
