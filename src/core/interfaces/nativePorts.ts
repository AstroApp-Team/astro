/**
 * Port for the phone's side of the app.
 *
 * The domain layer describes what it wants from the device; `infrastructure/native/`
 * decides whether the device can actually deliver it. Every method here is
 * fire-and-forget: haptics and status-bar styling are polish, and a failed
 * polish must never surface as an application error.
 */
export type HapticStyle = "light" | "medium" | "heavy" | "selection";

export interface HapticPort {
  impact(style: HapticStyle): void;
  notification(kind: "success" | "warning" | "error"): void;
}

export type StatusBarStyle = "light" | "dark" | "default";

export interface StatusBarPort {
  setStyle(style: StatusBarStyle): void;
}

export type Platform = "android" | "ios" | "web";

export interface PlatformPort {
  platform(): Platform;
  isNative(): boolean;
}
