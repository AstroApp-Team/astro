import { describe, expect, it } from "vite-plus/test";

import type { Clock } from "@core/interfaces/clock.ts";
import type { VoiceUsageRepository } from "@core/interfaces/voiceUsageRepository.ts";
import {
  costForSeconds,
  EMPTY_USAGE,
  usageToUsd,
  type VoiceUsage,
} from "@core/models/voiceUsage.ts";
import { createVoiceUsageTracker } from "@core/usecases/trackVoiceUsage.ts";

/**
 * The usecase, tested with fakes.
 *
 * Nothing here imports `infrastructure/`. The point of the port boundary is that
 * the money arithmetic can be tested with a twelve-line clock and a six-line
 * repository, and a test that reaches for `localStorage` is testing the
 * adapter's job. The adapter has its own test.
 */

/**
 * A clock you advance by hand.
 *
 * `every` deliberately does nothing: the tracker's tick is a persistence
 * optimisation, not the arithmetic, and a test that had to wait for a real
 * interval to see a second counted is a test that takes seconds to fail.
 */
class FakeClock implements Clock {
  private current = 0;

  now(): number {
    return this.current;
  }

  every(_periodMs: number, _task: () => void): () => void {
    return () => {
      /* nothing is scheduled */
    };
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

class FakeRepository implements VoiceUsageRepository {
  private saved: VoiceUsage | null = null;

  load(): VoiceUsage | null {
    return this.saved;
  }

  save(usage: VoiceUsage): void {
    this.saved = usage;
  }
}

function makeTracker() {
  const clock = new FakeClock();
  const repository = new FakeRepository();
  return { clock, repository, tracker: createVoiceUsageTracker({ repository, clock }) };
}

describe("createVoiceUsageTracker", () => {
  it("starts at zero", () => {
    const { tracker } = makeTracker();

    expect(tracker.getUsage()).toEqual(EMPTY_USAGE);
    expect(tracker.getCostUsd()).toBe(0);
    expect(usageToUsd(tracker.getUsage())).toBe(0);
  });

  it("bills wall-clock seconds between start and stop", () => {
    const { tracker, clock } = makeTracker();

    tracker.start();
    clock.advance(10_000);
    tracker.stop();

    expect(tracker.getUsage().seconds).toBe(10);
    expect(tracker.getCostUsd()).toBe(costForSeconds(10));
  });

  it("does not bill while stopped", () => {
    const { tracker, clock } = makeTracker();

    tracker.start();
    clock.advance(5_000);
    tracker.stop();
    clock.advance(60_000);
    tracker.stop();

    expect(tracker.getUsage().seconds).toBe(5);
  });

  it("accumulates across sessions", () => {
    const { tracker, clock } = makeTracker();

    tracker.start();
    clock.advance(4_000);
    tracker.stop();
    tracker.start();
    clock.advance(6_000);
    tracker.stop();

    expect(tracker.getUsage()).toEqual({ seconds: 10, sessions: 2 });
  });

  it("ignores a second start while a session is already open", () => {
    const { tracker, clock } = makeTracker();

    tracker.start();
    tracker.start();
    clock.advance(3_000);
    tracker.stop();

    expect(tracker.getUsage().sessions).toBe(1);
    expect(tracker.getUsage().seconds).toBe(3);
  });

  it("persists through the repository and reloads from it", () => {
    const { tracker, repository, clock } = makeTracker();

    tracker.start();
    clock.advance(3_000);
    tracker.stop();

    expect(repository.load()).toEqual({ seconds: 3, sessions: 1 });

    const restored = createVoiceUsageTracker({ repository, clock: new FakeClock() });
    expect(restored.getUsage().seconds).toBe(3);
  });

  it("notifies subscribers on each committed change", () => {
    const { tracker, clock } = makeTracker();
    const seen: number[] = [];

    tracker.subscribe(() => {
      seen.push(tracker.getUsage().seconds);
    });

    tracker.start();
    clock.advance(2_000);
    tracker.stop();

    expect(seen).toEqual([0, 2]);
  });

  it("stops notifying after the subscription is cancelled", () => {
    const { tracker, clock } = makeTracker();
    const seen: number[] = [];

    const unsubscribe = tracker.subscribe(() => {
      seen.push(tracker.getUsage().seconds);
    });
    unsubscribe();

    tracker.start();
    clock.advance(1_000);
    tracker.stop();

    expect(seen).toEqual([]);
  });

  it("reset clears the total and the stored copy", () => {
    const { tracker, repository, clock } = makeTracker();

    tracker.start();
    clock.advance(9_000);
    tracker.stop();
    tracker.reset();

    expect(tracker.getUsage()).toEqual(EMPTY_USAGE);
    expect(repository.load()).toEqual(EMPTY_USAGE);
  });
});
