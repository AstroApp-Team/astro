import { val, type ISheet, type ISequence } from "@theatre/core";
import { useEffect } from "react";

/** A `[from, to]` window in a sheet's sequence, in seconds. */
export type PlayRange = [from: number, to: number];

export type SheetPlayback = {
  /** Plays a range, defaulting to the whole sequence. */
  play(range?: PlayRange, rate?: number): void;
  /** Plays forever, alternating. The loop a rigged scene usually wants. */
  loop(range?: PlayRange): void;
  pause(): void;
  /** Pauses and puts the playhead back on zero. */
  reset(): void;
  /** Current playhead position, read once per render (not a live subscription). */
  position(): number;
  /** Length of the rigged sequence, in seconds. 0 for a sheet nobody has rigged. */
  length(): number;
};

/**
 * The writes, hoisted to module scope on purpose.
 *
 * A Theatre `ISheet` is a mutable handle by design — `sequence.position = n` is
 * how you move the playhead. Written inline in a hook body, the React Compiler
 * reads that as a prop mutation (`react-compiler(Immutability)`) and skips
 * optimizing the whole hook. These are plain functions, not components or hooks,
 * so the compiler leaves them alone and the hook stays optimizable.
 *
 * `exactOptionalPropertyTypes` is on, which is why `playSequence` assembles its
 * config conditionally instead of passing explicit `undefined`s.
 */
function seek(sequence: ISequence, at: number): void {
  sequence.position = at;
}

function playSequence(sequence: ISequence, conf: Parameters<ISequence["play"]>[0]): void {
  void sequence.play(conf);
}

function stopSequence(sequence: ISequence): void {
  sequence.pause();
}

/**
 * Plays a sheet's sequence, and hands the controls back to the caller.
 *
 * Why this exists as an adapter and not as a prop: `SheetProvider` in
 * `@theatre/r3f@0.7.2` accepts only `sheet` — there is no `autoPlay`, no
 * `sequence` prop. Playback is a call to `sheet.sequence.play()`, and a scene
 * component that calls it directly is a scene component that knows about
 * Theatre's sequence API. This keeps that in `infrastructure/`.
 *
 * `autoPlay` lands in an effect's dependency list, so it **must be a module
 * constant**. An array literal in a component body is a new array every render,
 * and the effect re-runs every render — the clip restarts under the Studio
 * playhead and reads as a scrub that will not stick.
 *
 * Nothing here subscribes to the playhead. A component that renders the position
 * would re-render 60 times a second; read `position()` from an event handler
 * (the rig bench's toolbar does exactly that).
 */
export function useSheetPlayback(sheet: ISheet, autoPlay: PlayRange | null = null): SheetPlayback {
  const sequence = sheet.sequence;

  useEffect(() => {
    if (autoPlay == null) return;

    seek(sequence, autoPlay[0]);
    playSequence(sequence, { range: autoPlay });

    // A scene that unmounts mid-clip leaves the playhead wherever it stopped,
    // so the next mount starts from a frame in the middle of the animation.
    return () => {
      stopSequence(sequence);
    };
  }, [sequence, autoPlay]);

  return {
    play(range, rate) {
      playSequence(sequence, {
        ...(range == null ? {} : { range }),
        ...(rate == null ? {} : { rate }),
      });
    },
    loop(range) {
      playSequence(sequence, {
        iterationCount: Number.POSITIVE_INFINITY,
        direction: "alternateReverse",
        ...(range == null ? {} : { range }),
      });
    },
    pause() {
      stopSequence(sequence);
    },
    reset() {
      stopSequence(sequence);
      seek(sequence, 0);
    },
    position() {
      return sequence.position;
    },
    length() {
      return val(sequence.pointer.length);
    },
  };
}
