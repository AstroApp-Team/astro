/** Cancels a scheduled callback. Safe to call more than once. */
export type CancelTick = () => void;

/**
 * Port for wall-clock time and repetition.
 *
 * The session meter is the app's only real-world clock, and injecting it is
 * what lets the meter be tested against fake time without a timer library in
 * the domain layer.
 */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Runs `callback` every `intervalMs`, returning the cancel handle. */
  every(intervalMs: number, callback: () => void): CancelTick;
}
