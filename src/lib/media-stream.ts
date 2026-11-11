export type AudioTrackLike = {
  readyState: MediaStreamTrackState | string;
  enabled: boolean;
  stop(): void;
};

export type MediaStreamLike<TTrack extends AudioTrackLike = AudioTrackLike> = {
  getAudioTracks(): TTrack[];
  getTracks(): TTrack[];
  clone?: () => MediaStreamLike<TTrack>;
};

/** Returns true if the stream currently owns at least one live audio track. */
export function hasLiveAudioTrack(stream: MediaStreamLike | null | undefined): boolean {
  if (!stream) return false;
  return stream.getAudioTracks().some((track) => track.readyState === "live");
}

/** Toggles `enabled` on every audio track in the stream without ending the tracks. */
export function setAudioTracksEnabled(
  stream: MediaStreamLike | null | undefined,
  enabled: boolean,
): void {
  if (!stream) return;
  for (const track of stream.getAudioTracks()) {
    track.enabled = enabled;
  }
}

/** Stops every track in a stream, releasing hardware or cloned capture pipelines. */
export function stopMediaStream(stream: MediaStreamLike | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Clones a MediaStream when supported so passing the clone into an SDK that
 * stops its capture stream on `stopAudioCapture()` leaves the master stream live.
 */
export function cloneAudioStream<TStream extends MediaStreamLike>(stream: TStream): TStream {
  return typeof stream.clone === "function" ? (stream.clone() as TStream) : stream;
}
