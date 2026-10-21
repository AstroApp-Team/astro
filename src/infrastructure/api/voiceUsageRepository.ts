import type { StorageGateway } from "@core/interfaces/storage.ts";
import type { VoiceUsageRepository } from "@core/interfaces/voiceUsageRepository.ts";
import { isVoiceUsage } from "@core/models/voiceUsage.ts";
import { browserStorage } from "@infra/api/browserStorage.ts";

export const STORAGE_KEY = "astro.voice-usage.v2";

/**
 * The usage total as a JSON string in `localStorage`.
 *
 * `JSON.parse` returns `unknown`, so the record is validated before it is
 * trusted: a key written by an older build, a tampered devtools edit, or a
 * truncated quota write all return `null` — "no history" — rather than
 * propagating `undefined` into the meter's arithmetic. Deciding that no history
 * means a zeroed total is the usecase's call, which is why this returns null and
 * not `EMPTY_USAGE`.
 *
 * The storage gateway is a parameter so a test can hand it a poisoned payload,
 * and so a Capacitor file-backed gateway can replace `localStorage` without
 * touching anything above this file.
 */
export function createVoiceUsageRepository(
  storage: StorageGateway = browserStorage,
): VoiceUsageRepository {
  return {
    load() {
      const raw = storage.read(STORAGE_KEY);
      if (raw == null) return null;

      try {
        const parsed: unknown = JSON.parse(raw);
        return isVoiceUsage(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(usage) {
      storage.write(STORAGE_KEY, JSON.stringify(usage));
    },
  };
}

export const voiceUsageRepository: VoiceUsageRepository = createVoiceUsageRepository();
