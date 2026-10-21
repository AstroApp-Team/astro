import type { Clock } from "@core/interfaces/clock.ts";

/**
 * The real clock.
 *
 * The only adapter that is genuinely one line long, and the reason the port
 * exists: tests hand the meter a fake clock and advance it by hand, production
 * hands it this one.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  every(intervalMs, callback) {
    const handle = setInterval(callback, intervalMs);
    return () => clearInterval(handle);
  },
};
