import { useEffect, useEffectEvent } from "react";

/**
 * An unattended open session is a leak: the microphone keeps streaming into a
 * conversation whose whole history is re-billed on every turn.
 */
export const IDLE_TIMEOUT_MS = 2 * 60_000;

/**
 * The signs of life that re-arm the timer. Each is compared by identity, so a
 * transcript that grows (a new `messages` array), the model starting or
 * stopping audio, a finished build and a click inside the app all count, and an
 * unrelated re-render does not.
 */
export type IdleActivity = {
  messages: unknown;
  isPlaying: boolean;
  report: unknown;
  viewEvent: unknown;
};

/**
 * Calls `onIdle` once `timeoutMs` passes with `active` true and no change in
 * `activity`.
 *
 * A timer that every sign of life re-arms, rather than a "last activity"
 * timestamp written from the realtime hook's `onEvent`: a ref written inside a
 * callback handed to a hook is something the React Compiler cannot prove
 * happens outside render, so it skipped the whole voice screen.
 */
export function useIdleHangUp(
  active: boolean,
  activity: IdleActivity,
  onIdle: () => void,
  timeoutMs: number = IDLE_TIMEOUT_MS,
): void {
  /* An effect event, so a new `onIdle` each render does not re-arm the timer. */
  const fire = useEffectEvent(onIdle);
  const { messages, isPlaying, report, viewEvent } = activity;

  useEffect(() => {
    if (!active) return;

    const timer = setTimeout(fire, timeoutMs);
    return () => clearTimeout(timer);
  }, [active, timeoutMs, messages, isPlaying, report, viewEvent]);
}
