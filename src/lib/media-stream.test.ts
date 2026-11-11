import { describe, expect, it, vi } from "vite-plus/test";

import {
  cloneAudioStream,
  hasLiveAudioTrack,
  setAudioTracksEnabled,
  stopMediaStream,
  type AudioTrackLike,
  type MediaStreamLike,
} from "./media-stream.ts";

function makeStream(readyState: "live" | "ended" = "live"): {
  stream: MediaStreamLike<AudioTrackLike>;
  track: AudioTrackLike;
} {
  const track: AudioTrackLike = {
    readyState,
    enabled: true,
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
  };
  const stream: MediaStreamLike<AudioTrackLike> = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
    clone: () => makeStream(track.readyState === "live" ? "live" : "ended").stream,
  };
  return { stream, track };
}

describe("media-stream helpers", () => {
  it("detects live audio tracks cleanly", () => {
    expect(hasLiveAudioTrack(null)).toBe(false);
    expect(hasLiveAudioTrack(makeStream("ended").stream)).toBe(false);
    expect(hasLiveAudioTrack(makeStream("live").stream)).toBe(true);
  });

  it("toggles track.enabled without ending tracks", () => {
    const { stream, track } = makeStream("live");
    setAudioTracksEnabled(stream, false);
    expect(track.enabled).toBe(false);
    expect(track.readyState).toBe("live");
    expect(track.stop).not.toHaveBeenCalled();

    setAudioTracksEnabled(stream, true);
    expect(track.enabled).toBe(true);
  });

  it("keeps the master stream live when a cloned capture stream is stopped", () => {
    const { stream: master } = makeStream("live");
    const cloned = cloneAudioStream(master);

    expect(cloned).not.toBe(master);
    stopMediaStream(cloned);

    expect(hasLiveAudioTrack(cloned)).toBe(false);
    expect(hasLiveAudioTrack(master)).toBe(true);
  });
});
