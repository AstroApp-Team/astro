/**
 * One `LayerDef` on an infinite plane, laid out deterministically and then nudged by the file.
 *
 * The layout engine (`layoutLayer`) is the fallback: a node the author has never dragged sits
 * where its rank and its siblings put it, so a definition loaded from disk is readable without
 * anyone having arranged it. Once a node is dragged, its point lives in the editor file and
 * wins. That split is why a definition and a workspace can be saved independently — and why
 * deleting a state cannot leave a stale card behind, because a card is rendered from the
 * definition and only its *position* comes from the file.
 *
 * Three interactions, and the pointer math is the whole of the difficulty:
 * a drag moves cards (committed once, on release), a drag from an output port draws a
 * transition (the port's own hit target, not the card's), and a wheel zooms around the
 * pointer rather than around the origin — zooming around the origin slides the card the
 * cursor is over away from the cursor, which reads as the graph fighting the hand.
 */

import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type {
  LayerDef,
  MachineDefinition,
  TransitionDef,
} from "@core/models/animationStateMachine.ts";
import type { Selection } from "@core/models/animationStateMachineEditor.ts";
import { LAYOUT, layoutLayer } from "@core/usecases/animationStateMachine/editorLayout.ts";
import { clipIdOf, stateKey, systemKey } from "@core/usecases/animationStateMachine/editorOps.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useMachineStore } from "@presentation/state/useMachineStore.ts";

interface Point {
  x: number;
  y: number;
}

const CARD = { width: 176, height: 62, radius: 12 };
const PILL = { width: 84, height: 30, radius: 999 };

function cardOf(layout: ReturnType<typeof layoutLayer>, key: string): Point | undefined {
  return layout.nodes[key];
}

/**
 * A cubic between two **already-anchored** edge points, bowed horizontally.
 *
 * The points are edge midpoints, not card corners: `anchorOf` and `pillAnchor` return the
 * exact pixel the SVG draws, so this function must not add a card's width or half-height
 * again. It used to, and the result was a link that started half a card past the card's
 * right edge and ended half a card below the target's midline — which reads as "the lines
 * are not connected to the nodes" rather than as a double offset.
 */
function linkPath(from: Point, to: Point): string {
  /*
   * Straight, and that is the request: a transition is one edge with a direction, and a bezier
   * between two cards 40 px apart is a wobble that hides which node it lands on. The direction is
   * carried by the arrow badge at the midpoint (`LinkBadge`), which is also the click target — so
   * the line can be 1.5 px and still be an editor.
   */
  return `M ${String(from.x)} ${String(from.y)} L ${String(to.x)} ${String(to.y)}`;
}

function linkMid(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/** The badge's rotation, in degrees, so the arrow points from `from` to `to`. */
function linkAngle(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/**
 * The circular handle sitting on every transition.
 *
 * It is the transition's *button*: the visible line is not a hit target of its own, because a
 * 1.5 px stroke is unfindable on a trackpad and the drag area around it would swallow the canvas.
 * A circle at the midpoint, with an arrow showing the direction, is where a person already aims;
 * pressing it selects the transition, which is what opens the editor deck under the dope sheet.
 */
function LinkBadge({
  from,
  to,
  selected,
  anyState,
  onSelect,
  onHover,
}: {
  from: Point;
  to: Point;
  selected: boolean;
  anyState: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const mid = linkMid(from, to);
  const angle = linkAngle(from, to);
  return (
    <g
      className="ed-link__badge"
      data-selected={selected ? "true" : undefined}
      data-any={anyState ? "true" : undefined}
      transform={`translate(${String(mid.x)} ${String(mid.y)})`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerEnter={onHover}
    >
      {/* An SVG group cannot be a `<button>`; the deck is the accessible editor, and this is its
          pointer target. The title is what a hover says the shape is. */}
      <title>Edit this transition</title>
      {/* Draw radius 8; hit radius 13, so the target survives a touch screen. */}
      <circle className="ed-link__badge-hit" r={13} />
      <circle className="ed-link__badge-ring" r={8} />
      <g transform={`rotate(${String(angle)})`}>
        <path className="ed-link__badge-arrow" d="M -3.4 -3.4 L 3.6 0 L -3.4 3.4" />
      </g>
    </g>
  );
}

function isTransition(selection: Selection, layer: string, index: number): boolean {
  return selection?.kind === "transition" && selection.layer === layer && selection.index === index;
}

function NodeCard({
  layer,
  stateId,
  point,
  onDragStart,
  onSelect,
  onPortStart,
  selection,
  hovering,
}: {
  layer: LayerDef;
  stateId: string;
  point: Point;
  onDragStart: (event: ReactPointerEvent, key: string, point: Point) => void;
  onSelect: (selection: Selection) => void;
  onPortStart: (event: ReactPointerEvent, stateId: string, point: Point) => void;
  selection: Selection;
  hovering: Selection;
}) {
  const state = layer.states.find((row) => row.id === stateId);
  const active = useMachineStore((snapshot) => snapshot.active);
  const live = active.find((row) => row.layer === layer.id && row.state === stateId);
  const selected =
    selection?.kind === "state" && selection.layer === layer.id && selection.state === stateId;
  const hovered =
    hovering?.kind === "state" && hovering.layer === layer.id && hovering.state === stateId;

  if (state == null) return null;
  const clipId = ("timeline" in state ? state.timeline : null) ?? clipIdOf(state);
  return (
    <g
      className="ed-node"
      data-selected={selected ? "true" : undefined}
      data-hovered={hovered ? "true" : undefined}
      data-live={live == null ? undefined : "true"}
      transform={`translate(${String(point.x)} ${String(point.y)})`}
      onPointerDown={(event) => {
        if ((event.target as Element).closest(".ed-port") != null) return;
        onDragStart(event, stateKey(layer.id, stateId), point);
        onSelect({ kind: "state", layer: layer.id, state: stateId });
      }}
      onDoubleClick={() => onSelect({ kind: "state", layer: layer.id, state: stateId })}
    >
      <rect
        width={CARD.width}
        height={CARD.height}
        rx={CARD.radius}
        className="ed-node__bg"
        data-type={state.type}
      />
      <text className="ed-node__title" x={14} y={25}>
        {stateId}
      </text>
      <text className="ed-node__meta" x={14} y={45}>
        {state.type}
        {clipId == null ? "" : ` · ${clipId.replace(/^.*\//, "")}`}
      </text>
      {live == null ? null : (
        <rect
          className="ed-node__progress"
          x={14}
          y={CARD.height - 9}
          width={(CARD.width - 28) * Math.max(0, Math.min(1, live.progress))}
          height={3}
          rx={2}
        />
      )}
      <g
        className="ed-port"
        transform={`translate(${String(CARD.width)} ${String(CARD.height / 2)})`}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPortStart(event, stateId, portOf(point));
        }}
      >
        <circle r={7} />
      </g>
    </g>
  );
}

function PillNode({
  kind,
  point,
  layer,
  selection,
  onSelect,
}: {
  kind: "entry" | "any" | "exit";
  point: Point;
  layer: string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <g
      className="ed-pill"
      data-role={kind}
      data-selected={
        selection?.kind === "layer" && selection.layer === layer && kind === "entry"
          ? "true"
          : undefined
      }
      transform={`translate(${String(point.x)} ${String(point.y)})`}
      onPointerDown={() => onSelect({ kind: "layer", layer })}
    >
      <rect width={PILL.width} height={PILL.height} rx={PILL.radius} />
      <text x={PILL.width / 2} y={PILL.height / 2 + 4} textAnchor="middle">
        {kind}
      </text>
    </g>
  );
}

/** The pixel a link leaves a node from: the card's right edge, or a pill's. */
function anchorOf(point: Point, kind: "card" | "pill"): Point {
  return kind === "card"
    ? { x: point.x + CARD.width, y: point.y + CARD.height / 2 }
    : { x: point.x + PILL.width, y: point.y + PILL.height / 2 };
}

/** Where a link enters a card: its left edge, on the midline. */
function targetOf(point: Point): Point {
  return { x: point.x, y: point.y + CARD.height / 2 };
}

/** The port on a card's right edge, which is where a drag-to-connect starts. */
function portOf(point: Point): Point {
  return { x: point.x + CARD.width, y: point.y + CARD.height / 2 };
}

function linkRows(layer: LayerDef): { row: TransitionDef; index: number; anyState: boolean }[] {
  return [
    ...layer.transitions.map((row, index) => ({ row, index, anyState: false })),
    ...layer.anyState.map((row, index) => ({ row, index, anyState: true })),
  ];
}

export type TimelineDropTarget =
  | { kind: "canvas" }
  | { kind: "state"; stateId: string }
  | { kind: "transition"; index: number; from: string; to: string; anyState: boolean };

export function GraphCanvas({
  layer,
  onTimelineDrop,
}: {
  layer: LayerDef;
  /** Called with the node or link under a dropped timeline, or `canvas` for empty space. */
  onTimelineDrop?: (timelineId: string, target: TimelineDropTarget) => void;
}) {
  const file = useEditorStore((state) => state.file);
  const selection = useEditorStore((state) => state.selection);
  const hovering = useEditorStore((state) => state.hovered);
  const select = useEditorStore((state) => state.select);
  const hover = useEditorStore((state) => state.hover);
  const moveNodes = useEditorStore((state) => state.moveNodes);
  const setZoom = useEditorStore((state) => state.setZoom);
  const setPan = useEditorStore((state) => state.setPan);
  const addTransition = useEditorStore((state) => state.addTransition);

  const surface = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<Record<string, Point>>({});
  /**
   * The same provisional positions, in a ref.
   *
   * `endDrag` commits `dragging`, and state is one render behind: a pointer-up that lands in the
   * same batch as the last move sees `{}` and commits nothing, so the card snaps back to where it
   * started. Intermittent, and it reads as "dragging only works sometimes". The ref is written on
   * every move, so the commit always has the latest positions.
   */
  const draggingRef = useRef<Record<string, Point>>({});
  const [connecting, setConnecting] = useState<{ from: string; origin: Point; at: Point } | null>(
    null,
  );
  const dragRef = useRef<{ keys: Record<string, Point>; origin: Point; start: Point } | null>(null);
  const panRef = useRef<{ origin: Point; start: Point } | null>(null);
  /** Set by the first pan/zoom: from then on a resize must not yank the viewport back. */
  const viewportMoved = useRef(false);

  const layout = layoutLayer(layer);
  const zoom = file.layout.zoom;
  const pan = file.layout.pan;

  const pointOf = (key: string, fallback: Point | undefined): Point => {
    const dragged = dragging[key];
    if (dragged != null) return dragged;
    const stored = key.includes("__") ? file.layout.systemNodes[key] : file.layout.nodes[key];
    return stored ?? fallback ?? { x: LAYOUT.originX, y: LAYOUT.originY };
  };

  /** Client pixels → graph-space pixels, through the pan/zoom transform. */
  const toGraph = (clientX: number, clientY: number): Point => {
    const rect = surface.current?.getBoundingClientRect();
    if (rect == null) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  /**
   * Ends *every* gesture, because the surface captures the pointer for all three of them.
   *
   * The pan used to be the exception: `panRef` was set on pointer-down and nothing cleared it,
   * so once the surface had been panned, every later pointer move (with no button held) kept
   * applying the pan delta — the canvas "followed the mouse forever" and only a reload stopped
   * it. Clearing it here is the whole fix; the capture is released by the browser on pointer-up,
   * and the move handler's `panRef.current != null` guard is what makes the drag live at all.
   */
  const endDrag = () => {
    const drag = dragRef.current;
    const latest = draggingRef.current;
    if (drag != null && Object.keys(latest).length > 0) moveNodes(latest);
    dragRef.current = null;
    panRef.current = null;
    draggingRef.current = {};
    setDragging({});
    setConnecting(null);
  };

  const onWheel = (event: ReactWheelEvent) => {
    event.preventDefault();
    viewportMoved.current = true;
    const rect = surface.current?.getBoundingClientRect();
    if (rect == null) return;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = Math.min(2, Math.max(0.35, zoom * factor));
    /* Keep the graph point under the cursor fixed: zoom around the pointer, not the origin. */
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const gx = (px - pan.x) / zoom;
    const gy = (py - pan.y) / zoom;
    setZoom(next);
    setPan({ x: px - gx * next, y: py - gy * next });
  };

  const startNodeDrag = (event: ReactPointerEvent, key: string, point: Point) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      keys: { [key]: point },
      origin: toGraph(event.clientX, event.clientY),
      start: point,
    };
    setDragging({ [key]: point });
  };

  const startPort = (event: ReactPointerEvent, from: string, at: Point) => {
    /* The SVG owns the gesture (it is where pointer-move and pointer-up are handled). Capturing
       on the port's own `<g>` sends those events there instead, where nothing listens, so the
       draft line froze at the port and no transition could ever be completed. */
    surface.current?.setPointerCapture?.(event.pointerId);
    setConnecting({ from, origin: at, at });
  };

  const anyPoint = pointOf(
    systemKey(layer.id, "any"),
    layout.systemNodes[systemKey(layer.id, "any")],
  );
  const entryPoint = pointOf(
    systemKey(layer.id, "entry"),
    layout.systemNodes[systemKey(layer.id, "entry")],
  );
  const exitPoint = pointOf(
    systemKey(layer.id, "exit"),
    layout.systemNodes[systemKey(layer.id, "exit")],
  );

  /**
   * Frame the whole layer.
   *
   * A rig page opens with the deck expanded and the graph in a 200px row, so the second row of
   * cards is off-screen until someone pans — which reads as "my states are gone". Fitting on
   * demand (and on the button's first press) is the one gesture that makes the graph usable at
   * any pane size, and it has to account for the *card* size, not just the origin points.
   */
  const fitToLayer = () => {
    const el = surface.current;
    if (el == null) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const points: { point: Point; width: number; height: number }[] = [];
    for (const state of layer.states) {
      const key = stateKey(layer.id, state.id);
      points.push({
        point: pointOf(key, cardOf(layout, key)),
        width: CARD.width,
        height: CARD.height,
      });
    }
    for (const kind of ["entry", "any", "exit"] as const) {
      const key = systemKey(layer.id, kind);
      points.push({
        point: pointOf(key, layout.systemNodes[key]),
        width: PILL.width,
        height: PILL.height,
      });
    }
    if (points.length === 0) return;

    const minX = Math.min(...points.map((p) => p.point.x));
    const minY = Math.min(...points.map((p) => p.point.y));
    const maxX = Math.max(...points.map((p) => p.point.x + p.width));
    const maxY = Math.max(...points.map((p) => p.point.y + p.height));
    const pad = 32;
    const nextZoom = Math.min(
      1.1,
      Math.max(
        0.35,
        Math.min(rect.width / (maxX - minX + pad * 2), rect.height / (maxY - minY + pad * 2)),
      ),
    );
    setZoom(nextZoom);
    setPan({
      x: rect.width / 2 - ((minX + maxX) / 2) * nextZoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * nextZoom,
    });
  };

  /*
   * Fit once per layer. The first paint has no box yet (the graph is inside a sized grid row), so
   * this cannot run during render; and a fit on *every* render would fight the pointer, which is
   * the one thing a viewport must never do.
   */
  const fitRef = useRef(fitToLayer);
  fitRef.current = fitToLayer;

  /*
   * Fit once the graph has a box. The first paint has none (the graph sits in a grid row that is
   * sized by its siblings), so a single mount-time fit measures 0x0 and gives up — which is the
   * state the graph opened in before, with the second row of cards under the fold. A frame loop is
   * the cheap way to wait for layout without a ResizeObserver that could yank a drag.
   */
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tryFit = () => {
      if (cancelled) return;
      const rect = surface.current?.getBoundingClientRect();
      if (rect == null || rect.width === 0 || rect.height === 0) {
        attempts += 1;
        if (attempts < 30) requestAnimationFrame(tryFit);
        return;
      }
      if (!viewportMoved.current) fitRef.current();
    };
    tryFit();
    return () => {
      cancelled = true;
    };
  }, [layer.id]);

  return (
    <div className="ed-graph__frame">
      <svg
        ref={surface}
        className="ed-graph"
        onWheel={onWheel}
        onDragOver={(event) => {
          if (onTimelineDrop == null) return;
          /* A drop target has to cancel the default to be droppable at all; `copy` shows intent. */
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (onTimelineDrop == null) return;
          event.preventDefault();
          const timelineId =
            event.dataTransfer.getData("text/x-astro-timeline") ||
            event.dataTransfer.getData("text/plain");
          if (timelineId === "") return;
          const at = toGraph(event.clientX, event.clientY);

          const state = layer.states.find((candidate) => {
            const point = pointOf(
              stateKey(layer.id, candidate.id),
              cardOf(layout, stateKey(layer.id, candidate.id)),
            );
            return (
              at.x >= point.x &&
              at.x <= point.x + CARD.width &&
              at.y >= point.y &&
              at.y <= point.y + CARD.height
            );
          });
          if (state != null) {
            onTimelineDrop(timelineId, { kind: "state", stateId: state.id });
            return;
          }

          /*
           * A link is thin, so a drop "on" it is a distance test rather than a hit test: sample the
           * curve between its two anchors and take the closest one within 14 graph pixels. The graph
           * is drawn at zoom 1 for hit-testing on purpose — a 6px link at zoom 0.4 is 2.4px on
           * screen, and requiring a pixel-accurate drop would make "insert a timeline on a
           * transition" a skill.
           */
          let closest: {
            index: number;
            from: string;
            to: string;
            anyState: boolean;
            distance: number;
          } | null = null;
          for (const { row, index, anyState } of linkRows(layer)) {
            const fromKey = stateKey(layer.id, row.from);
            const toKey = stateKey(layer.id, row.to);
            const from = anchorOf(pointOf(fromKey, cardOf(layout, fromKey)), "card");
            const to = targetOf(pointOf(toKey, cardOf(layout, toKey)));
            const distance = distanceToQuadratic(from, to, at);
            if (distance < 14 && (closest == null || distance < closest.distance)) {
              closest = { index, from: row.from, to: row.to, anyState, distance };
            }
          }
          if (closest != null) {
            onTimelineDrop(timelineId, {
              kind: "transition",
              index: closest.index,
              from: closest.from,
              to: closest.to,
              anyState: closest.anyState,
            });
            return;
          }
          onTimelineDrop(timelineId, { kind: "canvas" });
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag != null) {
            const at = toGraph(event.clientX, event.clientY);
            const dx = at.x - drag.origin.x;
            const dy = at.y - drag.origin.y;
            const next: Record<string, Point> = {};
            for (const [key, start] of Object.entries(drag.keys)) {
              next[key] = { x: start.x + dx, y: start.y + dy };
            }
            draggingRef.current = next;
            setDragging(next);
            return;
          }
          const origin = panRef.current;
          /*
           * `buttons === 0` means the release happened somewhere this element never saw (a blur,
           * a cancelled capture, a gesture the OS took). Ending the drag here is what makes
           * "the canvas follows the cursor after I let go" impossible rather than unlikely.
           */
          if (origin != null && event.buttons === 0) {
            endDrag();
            return;
          }
          if (origin != null) {
            const dx = event.clientX - origin.start.x;
            const dy = event.clientY - origin.start.y;
            setPan({ x: origin.origin.x + dx, y: origin.origin.y + dy });
          }
          if (connecting != null) {
            setConnecting({
              from: connecting.from,
              origin: connecting.origin,
              at: toGraph(event.clientX, event.clientY),
            });
          }
        }}
        onPointerUp={(event) => {
          /*
           * The transition is completed here, not by an `onPointerUp` on a drop rectangle.
           *
           * The surface captured the pointer when the port gesture began, and a captured pointer
           * retargets every later event to the capturing element — so the drop rectangles never
           * received a pointer-up, and dragging from a port produced a draft that could never be
           * released into a transition. Hit-testing the release point against the cards is the
           * one approach that works regardless of where the capture lives.
           */
          const connectingNow = connecting;
          if (connectingNow != null) {
            const at = toGraph(event.clientX, event.clientY);
            const target = layer.states.find((state) => {
              const point = pointOf(
                stateKey(layer.id, state.id),
                cardOf(layout, stateKey(layer.id, state.id)),
              );
              return (
                at.x >= point.x &&
                at.x <= point.x + CARD.width &&
                at.y >= point.y &&
                at.y <= point.y + CARD.height
              );
            });
            if (target != null) addTransition(layer.id, connectingNow.from, target.id);
          }
          endDrag();
        }}
        onPointerLeave={endDrag}
        onPointerDown={(event) => {
          if (
            (event.target as Element).closest(".ed-node, .ed-pill, .ed-link, .ed-link__hit") != null
          )
            return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          viewportMoved.current = true;
          panRef.current = {
            origin: pan,
            start: { x: event.clientX, y: event.clientY },
          };
          select(null);
        }}
      >
        <defs>
          <pattern
            id="ed-dots"
            width={24}
            height={24}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${String(pan.x % 24)} ${String(pan.y % 24)}) scale(${String(zoom)})`}
          >
            <circle cx={1} cy={1} r={1} className="ed-graph__dot" />
          </pattern>
        </defs>
        <rect className="ed-graph__bg" width="100%" height="100%" fill="url(#ed-dots)" />
        <g
          className="ed-graph__transform"
          transform={`translate(${String(pan.x)} ${String(pan.y)}) scale(${String(zoom)})`}
        >
          {layer.entry.map((row, index) => {
            const toPoint = pointOf(
              stateKey(layer.id, row.to),
              cardOf(layout, stateKey(layer.id, row.to)),
            );
            return (
              <path
                key={`entry:${row.to}:${String(index)}`}
                className="ed-link ed-link--entry"
                d={linkPath(
                  { x: entryPoint.x + PILL.width, y: entryPoint.y + PILL.height / 2 },
                  targetOf(toPoint),
                )}
              />
            );
          })}
          {linkRows(layer).map(({ row, index, anyState }) => {
            const fromKey = anyState ? systemKey(layer.id, "any") : stateKey(layer.id, row.from);
            const from = anyState
              ? anchorOf(anyPoint, "pill")
              : anchorOf(pointOf(fromKey, cardOf(layout, fromKey)), "card");
            const toPoint = pointOf(
              stateKey(layer.id, row.to),
              cardOf(layout, stateKey(layer.id, row.to)),
            );
            const to = targetOf(toPoint);
            const selected =
              selection?.kind === "transition" &&
              isTransition(selection, layer.id, index) &&
              selection.from === row.from;
            const path = linkPath(from, to);
            return (
              <g key={`${row.from}->${row.to}:${String(index)}:${String(anyState)}`}>
                <path
                  className="ed-link"
                  data-any={anyState ? "true" : undefined}
                  data-selected={selected ? "true" : undefined}
                  d={path}
                  pointerEvents="none"
                />
                <LinkBadge
                  from={from}
                  to={to}
                  selected={selected}
                  anyState={anyState}
                  onSelect={() => {
                    select({
                      kind: "transition",
                      layer: layer.id,
                      from: row.from,
                      to: row.to,
                      index,
                    });
                  }}
                  onHover={() => {
                    hover({
                      kind: "transition",
                      layer: layer.id,
                      from: row.from,
                      to: row.to,
                      index,
                    });
                  }}
                />
              </g>
            );
          })}
          {connecting == null ? null : (
            <path
              className="ed-link ed-link--draft"
              d={linkPath({ x: connecting.origin.x, y: connecting.origin.y }, connecting.at)}
            />
          )}
          {layer.states.map((state) => {
            const key = stateKey(layer.id, state.id);
            return (
              <NodeCard
                key={key}
                layer={layer}
                stateId={state.id}
                point={pointOf(key, cardOf(layout, key))}
                selection={selection}
                hovering={hovering}
                onDragStart={startNodeDrag}
                onSelect={select}
                onPortStart={startPort}
              />
            );
          })}
          <PillNode
            kind="entry"
            point={entryPoint}
            layer={layer.id}
            selection={selection}
            onSelect={select}
          />
          <PillNode
            kind="any"
            point={anyPoint}
            layer={layer.id}
            selection={selection}
            onSelect={select}
          />
          <PillNode
            kind="exit"
            point={exitPoint}
            layer={layer.id}
            selection={selection}
            onSelect={select}
          />
        </g>
      </svg>
      <button
        type="button"
        className="ed-graph__fit"
        title="Frame every state in this layer"
        onClick={fitToLayer}
      >
        Fit
      </button>
    </div>
  );
}

/**
 * Distance from a point to the link curve, sampled.
 *
 * The drawn curve is a cubic whose control points are the two anchors plus a horizontal bow, so
 * sampling it exactly the way `linkPath` draws it is the only way the visual and the hit test agree.
 */
function distanceToQuadratic(from: Point, to: Point, at: Point): number {
  const distance = Math.max(60, Math.abs(to.x - from.x) * 0.55);
  const c1 = { x: from.x + distance, y: from.y };
  const c2 = { x: to.x - distance, y: to.y };
  let best = Infinity;
  for (let i = 0; i <= 32; i += 1) {
    const t = i / 32;
    const u = 1 - t;
    const x = u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x;
    const y = u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y;
    best = Math.min(best, Math.hypot(x - at.x, y - at.y));
  }
  return best;
}

/** The layer the graph draws: the selected one, else the first. */
export function useGraphLayer(): LayerDef {
  const definition: MachineDefinition = useEditorStore((state) => state.definition);
  const fileLayer = useEditorStore((state) => state.file.debug.selectedLayer);
  return definition.layers.find((layer) => layer.id === fileLayer) ?? definition.layers[0]!;
}
