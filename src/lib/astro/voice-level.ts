/**
 * How loud Astro's voice is *right now*, for the halo to react to.
 *
 * The realtime hook plays the model's audio itself (`source.connect(ctx.destination)`
 * inside the AI SDK) and exposes no node to tap, so the level cannot come from an
 * `AnalyserNode` on the output. It comes from the same `audio-delta` chunks instead:
 * each one is decoded, cut into short frames, and scheduled on the timeline the SDK
 * uses for playback — a chunk starts at `max(end of the previous chunk, now)`. Chunks
 * arrive faster than they play, so reading the level at arrival time would light the
 * halo up seconds before the words are heard.
 *
 * The clock is `performance.now()`, not the SDK's `AudioContext.currentTime`; both run
 * at wall-clock rate from the same start, so they agree to within a frame.
 */

/** One envelope step. 20 ms is short enough to follow syllables and long enough to be stable. */
export const VOICE_FRAME_SECONDS = 0.02;

/**
 * RMS of a speech chunk → `0..1`.
 *
 * Conversational speech from the model sits around 0.03–0.25 RMS; below the floor is
 * breath and codec noise, and the gain puts ordinary speech near the top of the range.
 */
const NOISE_FLOOR = 0.01;
const GAIN = 5;

/** Loudness per `VOICE_FRAME_SECONDS` frame, each in `0..1`. */
export function voiceEnvelope(samples: Float32Array, sampleRate: number): number[] {
  const frameLength = Math.max(1, Math.round(sampleRate * VOICE_FRAME_SECONDS));
  const frames: number[] = [];

  for (let start = 0; start < samples.length; start += frameLength) {
    const end = Math.min(start + frameLength, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i] ?? 0;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / (end - start));
    frames.push(Math.min(1, Math.max(0, (rms - NOISE_FLOOR) * GAIN)));
  }

  return frames;
}

type Segment = { start: number; frameSeconds: number; frames: number[] };

/**
 * A queue of scheduled envelopes. `push` mirrors the SDK's scheduling; `level` reads
 * the frame playing at a given time; `clear` mirrors `stopPlayback`.
 */
export class VoiceLevelMeter {
  private segments: Segment[] = [];
  private cursor = 0;

  push(samples: Float32Array, sampleRate: number, now: number): void {
    const frames = voiceEnvelope(samples, sampleRate);
    const start = Math.max(this.cursor, now);
    this.segments.push({ start, frameSeconds: VOICE_FRAME_SECONDS, frames });
    this.cursor = start + samples.length / sampleRate;
  }

  level(now: number): number {
    /* Drop what has finished playing, so a long reply does not grow the queue. */
    while (this.segments.length > 0) {
      const first = this.segments[0]!;
      if (first.start + first.frames.length * first.frameSeconds > now) break;
      this.segments.shift();
    }

    const current = this.segments[0];
    if (current === undefined || current.start > now) return 0;
    const index = Math.floor((now - current.start) / current.frameSeconds);
    return current.frames[index] ?? 0;
  }

  clear(): void {
    this.segments = [];
    this.cursor = 0;
  }
}

/**
 * The one meter: `VoiceSession` writes it, `AstroCharacter`'s frame loop reads it.
 *
 * Module state rather than store state for the same reason `look` is read with
 * `getState()`: it changes every frame, and nothing should re-render because of it.
 */
export const astroVoiceLevel = new VoiceLevelMeter();

/** Seconds on the clock the meter is scheduled against. */
export function voiceClock(): number {
  return performance.now() / 1000;
}
