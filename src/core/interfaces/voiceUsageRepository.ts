import type { VoiceUsage } from "@core/models/voiceUsage.ts";

/**
 * Port for the durable voice-usage record.
 *
 * Split out from `StorageGateway` on purpose: the domain does not care that the
 * record happens to live in a JSON string under one key, only that a usage
 * total survives a reload.
 */
export interface VoiceUsageRepository {
  /**
   * `null` means "no usable history" — absent key, corrupt payload, quota
   * failure. What that means for the meter (a zeroed total) is the usecase's
   * decision, so the port does not encode it.
   */
  load(): VoiceUsage | null;
  save(usage: VoiceUsage): void;
}
