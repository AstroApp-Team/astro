/**
 * The session meter.
 *
 * This is the app's only money-adjacent state: the Gateway bills realtime by
 * *wall-clock seconds connected*, not by speech, so an open socket left running
 * is a leak. The meter is a clock, and it is the reason the UI shows a duration
 * rather than a message count.
 *
 * Everything impure — `localStorage`, `setInterval`, `Date.now` — arrives as a
 * port. That is what makes the meter testable against fake time, and what keeps
 * a timer out of the domain layer.
 */

import type { Clock } from "@core/interfaces/clock.ts";
import type { VoiceUsageRepository } from "@core/interfaces/voiceUsageRepository.ts";
import { EMPTY_USAGE, usageToUsd, type VoiceUsage } from "@core/models/voiceUsage.ts";
import { TICK_MS } from "@core/models/voiceUsage.ts";

export type VoiceUsageTracker = {
  /** Opens a session: counts it, starts the clock, begins persisting. */
  start(): void;
  /** Closes a session: banks what is owed and stops the clock. */
  stop(): void;
  /** Clears the banked total. Does not stop a running session. */
  reset(): void;
  getUsage(): VoiceUsage;
  getCostUsd(): number;
  subscribe(listener: () => void): () => void;
};

export function createVoiceUsageTracker(deps: {
  repository: VoiceUsageRepository;
  clock: Clock;
}): VoiceUsageTracker {
  /** Everything already banked. The live session's seconds are not in here yet. */
  /** No history is the usecase's decision, and "no history" means zero. */
  let banked: VoiceUsage = deps.repository.load() ?? EMPTY_USAGE;

  /** Snapshot handed to subscribers. Replaced (new identity) only when it changes. */
  let snapshot: VoiceUsage = banked;

  let liveSince: number | null = null;
  let cancelTick: (() => void) | null = null;

  const listeners = new Set<() => void>();

  function publish(next: VoiceUsage): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function persist(): void {
    deps.repository.save(banked);
  }

  function liveSeconds(): number {
    return liveSince == null ? 0 : (deps.clock.now() - liveSince) / 1000;
  }

  /**
   * Folds the elapsed time into the banked total and restarts the clock from
   * now, so a crash or a closed tab loses at most one tick.
   */
  function bankElapsed(): void {
    if (liveSince == null) return;

    banked = { ...banked, seconds: banked.seconds + liveSeconds() };
    liveSince = deps.clock.now();
    persist();
  }

  return {
    start() {
      if (liveSince != null) return;

      banked = { ...banked, sessions: banked.sessions + 1 };
      liveSince = deps.clock.now();
      persist();

      cancelTick = deps.clock.every(TICK_MS, () => {
        bankElapsed();
        publish(banked);
      });

      publish(banked);
    },

    stop() {
      bankElapsed();
      liveSince = null;

      if (cancelTick != null) {
        cancelTick();
        cancelTick = null;
      }

      publish(banked);
    },

    reset() {
      banked = EMPTY_USAGE;
      if (liveSince != null) liveSince = deps.clock.now();
      persist();
      publish(banked);
    },

    getUsage() {
      return snapshot;
    },

    getCostUsd() {
      return usageToUsd(snapshot);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
