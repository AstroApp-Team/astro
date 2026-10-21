import { SystemBars, SystemBarType, SystemBarsStyle } from "@capacitor/core";

import type { StatusBarPort, StatusBarStyle } from "@core/interfaces/nativePorts.ts";
import { isNativeMobile } from "@infra/native/PlatformService.ts";

/**
 * Status bar styling.
 *
 * `SystemBars` is a Capacitor *core* plugin — the native half ships inside
 * `@capacitor/android` and `@capacitor/ios`, so this needs no extra package and
 * no change to the native projects. On web it is a no-op, which is why the
 * native check is here rather than at every call site.
 *
 * `style: "dark"` means dark *content* on a light bar, matching Capacitor's own
 * naming, so the word reads the same in both layers.
 */
const STYLE: Record<StatusBarStyle, SystemBarsStyle> = {
  light: SystemBarsStyle.Light,
  dark: SystemBarsStyle.Dark,
  default: SystemBarsStyle.Default,
};

export const StatusBarService: StatusBarPort = {
  setStyle(style) {
    if (!isNativeMobile()) return;

    // Fire-and-forget: a bar that stays the old colour is not a failed action.
    void SystemBars.setStyle({ style: STYLE[style], bar: SystemBarType.StatusBar }).catch(() => {
      /* non-fatal */
    });
  },
};
