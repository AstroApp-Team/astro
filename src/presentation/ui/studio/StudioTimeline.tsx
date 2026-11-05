/**
 * The sheet's sequence, drawn like Theatre's dope sheet: one row per keyframed property, one
 * diamond per keyframe, a ruler you can scrub, and a playhead that follows playback.
 *
 * The panel used to be empty because it only knew the machine's timelines (its normalized
 * cursors), which is a different thing from the *sheet's* sequence — a machine clip's duration
 * is authored in the definition, and the keyframes live in Theatre. This view is the one an
 * author needs: it is what the Studio's dope sheet shows, from the same state file.
 *
 * Three interaction rules that were bugs before they were rules:
 *
 * - **A keyframe click selects; it never edits.** The diamond used to start a move on
 *   `pointerdown`, so a click that drifted one pixel rewrote the keyframe at a new time — which
 *   reads as "clicking it deleted it". A press now records a candidate, a move past 2 px starts a
 *   drag, and a release with no drag selects. `Delete`/`Backspace` removes the selection.
 * - **Positions are measured against the lane, not the scroller.** `getBoundingClientRect` of a
 *   scrolled container starts at the viewport edge, so every time was off by `scrollLeft / zoom`
 *   — with a scrolled timeline, clicking a diamond moved it left by however far you had scrolled.
 *   Each lane is a child of the scrollable content, so its own rect is in sequence space.
 * - **Zoom is anchored where the pointer is.** `Ctrl`/`⌘`/`Shift` + wheel (and the ± buttons)
 *   keep the second under the cursor under the cursor, which is the only way a wheel zoom is
 *   usable for fine trimming.
 */

import type { IStudio } from "@theatre/studio";
import { useEffect, useRef, useState } from "react";

import type { TimelineDef } from "@core/models/animationStateMachine.ts";
import { pauseSequence } from "@infra/theatre/useSheetPlayback.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";

import type { ISheet } from "./theatreView.ts";
import {
  deleteKeyframe,
  keyframesPastEnd,
  liveValue,
  moveKeyframe,
  readSpeed,
  seekTo,
  setSequenceLength,
  setSpeed,
  trackRows,
  writeProp,
} from "./theatreView.ts";

type KeyRef = { objectKey: string; encoded: string; at: number; path: string };
type Row = ReturnType<typeof trackRows>[number];

const MIN_ZOOM = 8;
const MAX_ZOOM = 1600;
const NAME_COLUMN = 208;

export function StudioTimeline({
  sheet,
  sheetId,
  studio,
  sequenceLength,
  onStatus,
}: {
  sheet: ISheet;
  sheetId: string;
  studio: IStudio | null;
  /** The sequence's length in seconds, read by the shell — `pointer.length` is not public. */
  sequenceLength: number;
  onStatus: (message: string) => void;
}) {
  const allRows = trackRows(sheetId, studio);
  /*
   * A timeline is a *sequence*: it owns a set of props and a window of the sheet, so the dope
   * sheet shows exactly those rows and its ruler runs over that window. `props` entries may be a
   * full path (`Astro.position.x`) or an object wildcard (`Astro.*`), because that is what an
   * author knows when they pick an object rather than a track.
   */
  const focused = useEditorStore((state) =>
    state.focusedTimeline == null
      ? null
      : ((state.definition.timelines ?? []).find((row) => row.id === state.focusedTimeline) ??
        null),
  );
  const focusTimeline = useEditorStore((state) => state.focusTimeline);
  const rows = matchRows(allRows, focused);
  const [length, setLength] = useState(sequenceLength);
  /*
   * The window this timeline plays, in sheet seconds. `offset 0, length = duration` is the
   * unfocused case and also the common one; a second timeline on the same sheet can start later
   * and stop earlier, which is the point of independent sequences.
   */
  const winStart = focused?.offset ?? 0;
  const winLength = Math.max(0.05, focused?.length ?? length);
  const [zoom, setZoom] = useState(120);
  const [speed, setSpeedState] = useState(() => readSpeed(sheet));
  const [playhead, setPlayhead] = useState(() => sheet.sequence.position);
  const [selected, setSelected] = useState<KeyRef | null>(null);
  const [dragFrame, setDragFrame] = useState<{ key: KeyRef; to: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const selectedObject = useSceneStore((state) => state.selectedNodeId);
  const selectNode = useSceneStore((state) => state.selectNode);

  /*
   * Zoom is wired **natively**, not with `onWheel`.
   *
   * React registers `wheel` delegates as passive, so `preventDefault()` there is a no-op and
   * Chromium logs "Unable to preventDefault inside passive event listener" while still letting the
   * page scroll under the zoom. The same trap is documented for `/surface`'s wheel handling; this
   * is the same fix, locally.
   */
  const zoomAtRef = useRef<(clientX: number, deltaY: number) => void>(() => {});
  zoomAtRef.current = (clientX, deltaY) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (rect == null) return;
    const at = Math.max(0, Math.min(length, (clientX - rect.left) / zoom));
    const next = Math.round(
      Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (deltaY < 0 ? 1.12 : 1 / 1.12))),
    );
    if (next === zoom) return;
    const cursorOffset = clientX - rect.left;
    setZoom(next);
    const scroller = scrollerRef.current;
    if (scroller != null) {
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, at * next - cursorOffset);
      });
    }
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller == null) return;
    const onWheel = (event: WheelEvent) => {
      /*
       * Alt, not Ctrl/⌘: Chrome reserves ctrl+wheel for browser zoom and the page never sees a
       * `deltaY` it can act on, so a ctrl-wheel zoom silently does nothing. Shift is the browser's
       * horizontal scroll, which a timeline should not steal.
       */
      if (!event.altKey) return;
      event.preventDefault();
      zoomAtRef.current(event.clientX, event.deltaY);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scroller.removeEventListener("wheel", onWheel);
    };
  }, []);

  /* The shell reads the length; a scene switch or a Studio edit has to reach this panel. */
  useEffect(() => {
    setLength(sequenceLength);
  }, [sequenceLength]);

  /*
   * The scrub target, and why it is re-asserted every frame.
   *
   * The ruler seeks once per `pointermove`, which is right for a pointer that is moving and wrong
   * for one that is *held*: anything else that owns the playhead — a looped preview, a machine
   * timeline wrapping, a Studio-driven replay — writes its own time on the next frame and the
   * playhead snaps away from the finger. The report was "after holding it for a while it drops
   * back to the start". So while a scrub is in flight the target is re-applied whenever the sheet
   * has drifted from it, which is a no-op when nothing else is writing.
   */
  const scrubTarget = useRef<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const target = scrubTarget.current;
      if (target != null && Math.abs(sheet.sequence.position - target) > 0.02) {
        seekTo(sheet, target);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [sheet]);

  /** A 30 Hz read of the playhead: one small component re-rendering, not the whole studio. */
  useEffect(() => {
    let frame = 0;
    let last = -1;
    const tick = () => {
      const at = sheet.sequence.position;
      if (Math.abs(at - last) > 0.004) {
        last = at;
        setPlayhead(at);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [sheet]);

  const pxOf = (seconds: number) => seconds * zoom;
  const width = Math.max(320, pxOf(winLength));
  const objects = [...new Set(rows.map((row) => row.objectKey))];
  const extent = (rect: DOMRect | undefined, clientX: number) =>
    rect == null ? 0 : Math.max(0, Math.min(winLength, (clientX - rect.left) / zoom));

  function seek(localSeconds: number) {
    /* Local → sheet: the ruler runs 0..`winLength`, the sheet runs `winStart..`. */
    const absolute = Math.max(0, Math.min(length, winStart + localSeconds));
    scrubTarget.current = absolute;
    seekTo(sheet, absolute);
    setPlayhead(sheet.sequence.position);
  }

  /**
   * Scrub: seek, and pause.
   *
   * Without the pause, a scrub on a playing sheet is invisible — the transport keeps running from
   * wherever the seek landed, so the playhead answers "what time is it now" instead of "where did
   * you put me".
   */
  function scrub(seconds: number) {
    sheet.sequence.pause();
    seek(seconds);
  }

  function keyframeAtPlayhead(objectKey: string, path: string) {
    const value = liveValue(sheet, objectKey, path);
    if (value == null) {
      onStatus(`No live value for ${objectKey}.${path} — the object is not on the sheet.`);
      return;
    }
    const result = writeProp(studio, sheet, objectKey, path, value);
    onStatus(
      result.ok
        ? `Keyframed ${objectKey}.${path} at ${sheet.sequence.position.toFixed(2)}s`
        : result.reason,
    );
  }

  function removeKeyframe(key: KeyRef) {
    const removed = deleteKeyframe(studio, sheet, key.objectKey, key.path, key.at);
    if (removed.ok) {
      onStatus(`Removed ${key.objectKey}.${key.path} @ ${key.at.toFixed(2)}s`);
      setSelected(null);
    } else {
      onStatus(removed.reason);
    }
  }

  /** Drag the ruler: a scrub that keeps tracking after the pointer leaves the 22px strip. */
  function scrubFrom(event: React.PointerEvent<HTMLDivElement>) {
    /*
     * Seek first, then pause: a scrub on a playing sequence is a seek that the next frame undoes,
     * and the playhead appears to ignore the drag.
     */
    pauseSequence(sheet.sequence);
    /*
     * Capture the rect **once**. Re-reading `rulerRef.current` on every move looked equivalent and
     * was not: the deck is keyed by the sheet revision, so an edit made during a long hold remounts
     * it, the ref is `null` for a frame, `extent(null) → 0`, and the playhead snapped to the start
     * mid-drag. A captured rect is also what "the ruler I pressed" means.
     */
    const rect = rulerRef.current?.getBoundingClientRect();
    if (rect == null) return;
    scrub(extent(rect, event.clientX));
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      scrub(extent(rect, moveEvent.clientX));
    };
    const finish = () => {
      scrubTarget.current = null;
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", finish);
      globalThis.removeEventListener("pointercancel", finish);
      globalThis.removeEventListener("keydown", onKey);
    };
    /* Escape ends a held scrub without leaving the playhead pinned to the last move. */
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish();
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", finish);
    globalThis.addEventListener("pointercancel", finish);
    globalThis.addEventListener("keydown", onKey);
  }

  /* Delete removes the selected keyframe — the only way besides double-clicking the diamond. */
  useEffect(() => {
    if (selected == null) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target != null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      const removed = deleteKeyframe(studio, sheet, selected.objectKey, selected.path, selected.at);
      onStatus(
        removed.ok
          ? `Removed ${selected.objectKey}.${selected.path} @ ${selected.at.toFixed(2)}s`
          : removed.reason,
      );
      if (removed.ok) setSelected(null);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [selected, sheet, studio, onStatus]);

  const step = zoom >= 240 ? 0.5 : zoom >= 90 ? 1 : zoom >= 40 ? 2 : 5;
  const ticks: number[] = [];
  for (let at = 0; at <= length + 1e-6; at += step) ticks.push(Number(at.toFixed(3)));
  const clipped = keyframesPastEnd(sheetId, studio, length);

  return (
    <div className="st-timeline">
      <header className="st-timeline__head">
        <strong>Sequence</strong>
        <label className="st-timeline__field" title="Sequence duration in seconds">
          <span>duration</span>
          <input
            className="ed-input st-timeline__number"
            type="number"
            min={0.1}
            step="0.1"
            value={Number(length.toFixed(2))}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next) || next <= 0) return;
              const result = setSequenceLength(studio, sheet, next);
              if (result.ok) setLength(next);
              else onStatus(result.reason);
            }}
          />
          <span className="ed-mono">s</span>
        </label>
        <label
          className="st-timeline__field"
          title="Playback speed — a transport setting, not saved with the sheet"
        >
          <span>speed</span>
          <select
            className="ed-input st-timeline__number"
            value={String(speed)}
            onChange={(event) => {
              setSpeed(sheet, Number(event.target.value));
              setSpeedState(readSpeed(sheet));
            }}
          >
            {[0.1, 0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
              <option key={rate} value={String(rate)}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        <span className="ed-mono">{playhead.toFixed(2)}s</span>
        <span className="ed-mono">
          {rows.length} track{rows.length === 1 ? "" : "s"}
        </span>
        {focused == null ? null : (
          <button
            type="button"
            className="ed-btn ed-btn--ghost st-timeline__focus"
            title="Show every track on the sheet again"
            onClick={() => {
              focusTimeline(null);
            }}
          >
            {focused.id} · {winStart.toFixed(2)}–{(winStart + winLength).toFixed(2)}s ✕
          </button>
        )}
        {clipped === 0 ? null : (
          <span className="st-timeline__warn" title="Playback clips these — they never play">
            {clipped} past end
          </span>
        )}
        <div className="st-timeline__zoom">
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => {
              setZoom((value) => Math.max(MIN_ZOOM, Math.round(value / 1.4)));
            }}
            title="Zoom out"
          >
            −
          </button>
          <span className="ed-mono st-timeline__zoomlabel">{Math.round(zoom)} px/s</span>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => {
              setZoom((value) => Math.min(MAX_ZOOM, Math.round(value * 1.4)));
            }}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="ed-btn ed-btn--ghost"
            onClick={() => {
              const fit = (scrollerRef.current?.clientWidth ?? 640) / Math.max(length, 0.1);
              setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(fit * 0.94))));
            }}
            title="Fit the sequence to the panel"
          >
            fit
          </button>
        </div>
      </header>

      <div className="st-timeline__scroll" ref={scrollerRef}>
        <div
          className="st-timeline__grid"
          style={{ gridTemplateColumns: `${NAME_COLUMN}px ${width}px` }}
        >
          <div className="st-timeline__corner">Object · property</div>
          <div
            className="st-ruler"
            ref={rulerRef}
            role="presentation"
            title="Drag to scrub"
            onPointerDown={scrubFrom}
          >
            {ticks
              .filter((at) => at <= winLength + 1e-6)
              .map((at) => (
                <span key={at} className="st-ruler__tick" style={{ left: pxOf(at) }}>
                  {at}s
                </span>
              ))}
          </div>

          {objects.map((objectKey) => (
            <RowGroup
              key={objectKey}
              objectKey={objectKey}
              rows={rows.filter((row) => row.objectKey === objectKey)}
              active={selectedObject === objectKey}
              zoom={zoom}
              offset={winStart}
              playhead={Math.max(0, Math.min(winLength, playhead - winStart))}
              selected={selected}
              dragFrame={dragFrame}
              onPick={() => {
                selectNode(objectKey);
              }}
              onKeyAll={() => {
                for (const row of rows) {
                  if (row.objectKey === objectKey) keyframeAtPlayhead(objectKey, row.path);
                }
              }}
              onScrub={(clientX, rect) => {
                scrub(extent(rect, clientX));
              }}
              onPin={keyframeAtPlayhead}
              onSelect={(key) => {
                setSelected(key);
                seek(key.at);
                selectNode(key.objectKey);
              }}
              onRemove={removeKeyframe}
              onDrag={(key, to) => {
                setDragFrame({ key, to });
              }}
              onDropDrag={(key, to) => {
                setDragFrame(null);
                const moved = moveKeyframe(
                  studio,
                  sheet,
                  sheetId,
                  key.objectKey,
                  key.path,
                  key.at,
                  to,
                );
                onStatus(moved.ok ? `Moved ${key.path} to ${to.toFixed(2)}s` : moved.reason);
                if (moved.ok) setSelected({ ...key, at: to });
              }}
            />
          ))}

          {rows.length === 0 ? (
            <p className="ed-empty st-timeline__empty">
              No keyframes on {sheetId}. Rig an object in the Studio (or press ◆ next to a property
              on the right) and it appears here.
            </p>
          ) : null}

          <span
            className="st-timeline__playhead"
            style={{
              left: NAME_COLUMN + pxOf(Math.max(0, Math.min(winLength, playhead - winStart))),
            }}
          />
        </div>
      </div>
      <FooterHint studio={studio} />
    </div>
  );
}

/**
 * One object's rows: its name + `◆` on the sticky left, its diamonds on the right.
 *
 * Split out so a selection change repaints one object's rows instead of the whole dope sheet —
 * this panel re-renders 30 times a second for the playhead.
 */
/**
 * The value a track has at `time`: the last keyframe at or before it, else the first key.
 *
 * A dope sheet without values answers "where are the keys" but not "what is it now", so a row of
 * diamonds is checked by scrubbing and looking at the 3D view. One number per row answers it in
 * place — and a row with no keys prints `—`, which is the only way to tell "static value" apart
 * from "keyframed to the same value twice".
 */
function valueAt(row: Row, time: number): unknown {
  let value: unknown = undefined;
  for (const frame of row.keyframes) {
    if (frame.position <= time + 1e-6) value = frame.value;
  }
  return value ?? row.keyframes[0]?.value;
}

function formatValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function RowGroup({
  objectKey,
  rows,
  active,
  zoom,
  offset,
  playhead,
  selected,
  dragFrame,
  onPick,
  onKeyAll,
  onScrub,
  onPin,
  onSelect,
  onRemove,
  onDrag,
  onDropDrag,
}: {
  objectKey: string;
  rows: Row[];
  active: boolean;
  zoom: number;
  /** The timeline's window start, in sheet seconds; diamonds are drawn relative to it. */
  offset: number;
  /** Sequence time, so each row can show the value it currently has and not just its keys. */
  playhead: number;
  selected: KeyRef | null;
  dragFrame: { key: KeyRef; to: number } | null;
  onPick: () => void;
  onKeyAll: () => void;
  onScrub: (clientX: number, rect: DOMRect | undefined) => void;
  onPin: (objectKey: string, path: string) => void;
  onSelect: (key: KeyRef) => void;
  onRemove: (key: KeyRef) => void;
  onDrag: (key: KeyRef, to: number) => void;
  onDropDrag: (key: KeyRef, to: number) => void;
}) {
  return (
    <>
      <div className="st-timeline__names" data-active={active}>
        <div className="st-timeline__objectrow">
          <button type="button" className="st-timeline__pick" title={objectKey} onClick={onPick}>
            {objectKey}
          </button>
          <button
            type="button"
            className="st-timeline__key"
            aria-label={`Keyframe every property of ${objectKey} at the playhead`}
            title="Keyframe every property of this object at the playhead"
            onClick={onKeyAll}
          />
        </div>
        {rows.map((row) => (
          <button
            key={row.encoded}
            type="button"
            className="st-timeline__row"
            title={`${row.objectKey}.${row.path} — ${String(row.keyframes.length)} keyframes`}
            data-empty={row.keyframes.length === 0}
            onClick={() => {
              onPin(row.objectKey, row.path);
            }}
          >
            <span className="st-timeline__path">{row.path}</span>
            <span className="st-timeline__value ed-mono">
              {formatValue(valueAt(row, playhead))}
            </span>
            <span className="st-timeline__count">{row.keyframes.length}</span>
          </button>
        ))}
      </div>

      <div className="st-timeline__lanes">
        <div className="st-lanes__objecthead" />
        {rows.map((row) => (
          <div
            key={row.encoded}
            className="st-lane"
            data-active={active}
            onDoubleClick={(event) => {
              onScrub(event.clientX, event.currentTarget.getBoundingClientRect());
              onPin(row.objectKey, row.path);
            }}
          >
            {row.keyframes.map((frame) => {
              const key: KeyRef = {
                objectKey: row.objectKey,
                path: row.path,
                encoded: row.encoded,
                at: frame.position,
              };
              /*
               * Match the object *and* the path: `encoded` is the per-object track path, so two
               * objects with `position.x` share it and a path-only test lights up four diamonds
               * when the author clicked one.
               */
              const isSelected =
                selected != null &&
                selected.objectKey === row.objectKey &&
                selected.encoded === row.encoded &&
                Math.abs(selected.at - frame.position) < 1e-3;
              const shown =
                dragFrame != null &&
                dragFrame.key.encoded === row.encoded &&
                Math.abs(dragFrame.key.at - frame.position) < 1e-3
                  ? dragFrame.to
                  : frame.position;
              return (
                <button
                  key={`${row.encoded}:${String(frame.position)}`}
                  type="button"
                  className="st-kf"
                  data-selected={isSelected}
                  aria-label={`${row.objectKey}.${row.path} keyframe at ${frame.position.toFixed(2)} seconds`}
                  style={{ left: (shown - offset) * zoom }}
                  title={`${row.objectKey}.${row.path} @ ${frame.position.toFixed(3)}s = ${String(frame.value)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(key);
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    const lane = event.currentTarget.parentElement;
                    if (lane == null) return;
                    const rect = lane.getBoundingClientRect();
                    const startX = event.clientX;
                    /* A press is a candidate, not a move: 2 px of slop is a click's worth. */
                    let moved = false;
                    let latest = frame.position;
                    const move = (moveEvent: PointerEvent) => {
                      if (!moved && Math.abs(moveEvent.clientX - startX) < 2) return;
                      moved = true;
                      latest = Math.max(0, (moveEvent.clientX - rect.left) / zoom);
                      onDrag(key, latest);
                    };
                    const up = () => {
                      globalThis.removeEventListener("pointermove", move);
                      globalThis.removeEventListener("pointerup", up);
                      globalThis.removeEventListener("pointercancel", up);
                      if (moved) onDropDrag(key, latest);
                    };
                    globalThis.addEventListener("pointermove", move);
                    globalThis.addEventListener("pointerup", up);
                    globalThis.addEventListener("pointercancel", up);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onRemove(key);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Which tracks belong to a timeline.
 *
 * `props` holds `ObjectKey.path` entries and `ObjectKey.*` wildcards — an object picker hands you
 * the object, not the track, and demanding a full path for every animated channel turns "make a
 * second sequence" into twenty clicks. An empty list means the whole sheet, which is what a
 * timeline created before this existed (and the unfocused deck) should show.
 */
function matchRows<T extends { objectKey: string; path: string }>(
  rows: T[],
  timeline: TimelineDef | null,
): T[] {
  const props = timeline?.props ?? [];
  if (props.length === 0) return rows;
  return rows.filter((row) =>
    props.some((prop) => {
      if (prop.endsWith(".*")) return prop.slice(0, -2) === row.objectKey;
      return prop === `${row.objectKey}.${row.path}`;
    }),
  );
}

function FooterHint({ studio }: { studio: IStudio | null }) {
  const dirty = useEditorStore((state) => state.dirty);
  return (
    <p className="st-timeline__hint">
      drag the ruler to scrub · drag a ◆ to retime · click a ◆ to select, ⌫ to delete · alt+wheel
      zooms time · ◆ on a row keys it at the playhead
      {studio == null ? " · read-only: the Studio is not loaded" : ""}
      {dirty ? "" : ""}
    </p>
  );
}
