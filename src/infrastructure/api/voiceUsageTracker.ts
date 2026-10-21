import { createVoiceUsageTracker, type VoiceUsageTracker } from "@core/usecases/trackVoiceUsage.ts";
import { systemClock } from "@infra/api/systemClock.ts";
import { voiceUsageRepository } from "@infra/api/voiceUsageRepository.ts";

/**
 * The app's single session meter.
 *
 * One instance for the whole app: the bill is per device, not per component, and
 * two trackers would each bank their own copy of the same wall clock.
 *
 * This is the composition root for the meter — the domain usecase meets its two
 * ports here, and nothing below this line knows `localStorage` exists.
 */
export const voiceUsageTracker: VoiceUsageTracker = createVoiceUsageTracker({
  repository: voiceUsageRepository,
  clock: systemClock,
});
