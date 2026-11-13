import { describe, expect, it } from "vite-plus/test";

import { VOICE_FRAME_SECONDS, VoiceLevelMeter, voiceEnvelope } from "./voice-level.ts";

const RATE = 1_000;
const FRAME = RATE * VOICE_FRAME_SECONDS;

function tone(amplitude: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(RATE * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? amplitude : -amplitude;
  return samples;
}

describe("voiceEnvelope", () => {
  it("is silent for silence and full for loud speech", () => {
    expect(voiceEnvelope(tone(0, 0.1), RATE).every((v) => v === 0)).toBe(true);
    expect(voiceEnvelope(tone(0.5, 0.1), RATE).every((v) => v === 1)).toBe(true);
  });

  it("cuts one value per frame, keeping a short tail", () => {
    expect(voiceEnvelope(tone(0.1, (FRAME * 3 + 1) / RATE), RATE)).toHaveLength(4);
  });
});

describe("VoiceLevelMeter", () => {
  it("plays chunks back to back, the way the SDK schedules them", () => {
    const meter = new VoiceLevelMeter();
    /* Both arrive at t=0; the second only starts once the first has played. */
    meter.push(tone(0.5, 0.1), RATE, 0);
    meter.push(tone(0, 0.1), RATE, 0);

    expect(meter.level(0.05)).toBe(1);
    expect(meter.level(0.15)).toBe(0);
    expect(meter.level(0.25)).toBe(0);
  });

  it("starts a chunk that arrives after a gap at its arrival time", () => {
    const meter = new VoiceLevelMeter();
    meter.push(tone(0.5, 0.1), RATE, 0);
    meter.push(tone(0.5, 0.1), RATE, 1);

    expect(meter.level(0.5)).toBe(0);
    expect(meter.level(1.05)).toBe(1);
  });

  it("goes quiet on clear, like stopPlayback", () => {
    const meter = new VoiceLevelMeter();
    meter.push(tone(0.5, 1), RATE, 0);
    meter.clear();
    expect(meter.level(0.5)).toBe(0);
  });
});
