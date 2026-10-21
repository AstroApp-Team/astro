/**
 * Domain model for what a voice session costs.
 *
 * Pure by construction: no `react`, `three`, `@capacitor/*` or `@theatre/*`
 * imports, no DOM, no timers of its own. Everything impure arrives through the
 * ports in `core/interfaces/`.
 *
 * The rate constant is imported from `shared/` rather than restated here: it is
 * the Gateway's published price, the Worker quotes it in the same response, and
 * two copies of a number that comes from a bill is how a bill gets misread.
 */

import { USD_PER_SESSION_SECOND } from "@shared/realtime.ts";

/** Running total of what the voice sessions have cost. */
export type VoiceUsage = {
  /** Wall-clock seconds connected, across all sessions. */
  seconds: number;
  /** How many sessions have been opened. */
  sessions: number;
};

export const EMPTY_USAGE: VoiceUsage = { seconds: 0, sessions: 0 };

/**
 * How often an open session folds its elapsed time into the banked total.
 * One second is the granularity the Gateway bills at, so it is the granularity
 * worth persisting at.
 */
export const TICK_MS = 1000;

export function costForSeconds(seconds: number): number {
  return seconds * USD_PER_SESSION_SECOND;
}

export function usageToUsd(usage: VoiceUsage): number {
  return costForSeconds(usage.seconds);
}

/** `123` → `2m 03s`. Display formatting, kept here so it is testable. */
export function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/**
 * The shape a persisted usage record must have to be trusted.
 *
 * Deliberately structural rather than Zod: this runs on every page load in the
 * client bundle, and pulling the validation library in for two numbers is how a
 * 12 KB dependency ends up in the mobile app.
 */
export function isVoiceUsage(value: unknown): value is VoiceUsage {
  if (typeof value !== "object" || value === null) return false;

  const { seconds, sessions } = value as Partial<VoiceUsage>;
  return typeof seconds === "number" && typeof sessions === "number";
}
