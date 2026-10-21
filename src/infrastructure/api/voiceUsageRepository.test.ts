import { describe, expect, it } from "vite-plus/test";

import { EMPTY_USAGE } from "@core/models/voiceUsage.ts";
import { createMemoryStorage } from "@infra/api/browserStorage.ts";
import { createVoiceUsageRepository, STORAGE_KEY } from "@infra/api/voiceUsageRepository.ts";
import { voiceUsageTracker } from "@infra/api/voiceUsageTracker.ts";

/**
 * The adapter half of the meter.
 *
 * The usecase test proves the arithmetic; this proves the two things only an
 * adapter can break — a payload that is not JSON, and a payload that is JSON but
 * not the shape. Both must read as "no history", which the repository spells
 * `null` and the usecase turns into zero.
 */
describe("createVoiceUsageRepository", () => {
  it("round-trips through storage", () => {
    const storage = createMemoryStorage();
    const repository = createVoiceUsageRepository(storage);
    const usage = { seconds: 12, sessions: 3 };

    repository.save(usage);

    expect(repository.load()).toEqual(usage);
    expect(JSON.parse(storage.read(STORAGE_KEY) ?? "null")).toEqual(usage);
  });

  it("reads an empty store as no history", () => {
    expect(createVoiceUsageRepository(createMemoryStorage()).load()).toBeNull();
  });

  it("reads a corrupt payload as no history", () => {
    const storage = createMemoryStorage({ [STORAGE_KEY]: "{not json" });

    expect(createVoiceUsageRepository(storage).load()).toBeNull();
  });

  it("reads a well-formed payload with the wrong shape as no history", () => {
    const storage = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify({ seconds: "twelve" }) });

    expect(createVoiceUsageRepository(storage).load()).toBeNull();
  });

  it("can write the zeroed total back", () => {
    const storage = createMemoryStorage();
    const repository = createVoiceUsageRepository(storage);

    repository.save({ seconds: 7, sessions: 1 });
    repository.save(EMPTY_USAGE);

    expect(repository.load()).toEqual(EMPTY_USAGE);
  });
});

describe("voiceUsageTracker", () => {
  it("is a live tracker over the real clock", () => {
    const before = voiceUsageTracker.getUsage();

    voiceUsageTracker.start();
    voiceUsageTracker.stop();

    expect(voiceUsageTracker.getUsage().sessions).toBe(before.sessions + 1);
    expect(voiceUsageTracker.getCostUsd()).toBeGreaterThanOrEqual(0);
  });
});
