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
import { useRef, useState } from "react";

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

/** A cubic from the right edge of one card to the left edge of the next, bowed horizontally. */
function linkPath(from: Point, to: Point): string {
  const x1 = from.x + CARD.width;
  const y1 = from.y + CARD.height / 2;
  const x2 = to.x;
  const y2 = to.y + CARD.height / 2;
  const distance = Math.max(60, Math.abs(x2 - x1) * 0.55);
  return `M ${String(x1)} ${String(y1)} C ${String(x1 + distance)} ${String(y1)}, ${String(
    x2 - distance,
  )} ${String(y2)}, ${String(x2)} ${String(y2)}`;
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
          onPortStart(event, stateId, { x: point.x + CARD.width, y: point.y + CARD.height / 2 });
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

/** The any-state pill's transitions start at its right edge, not at a card's. */
function anchorOf(point: Point, kind: "card" | "pill"): Point {
  return kind === "card"
    ? { x: point.x, y: point.y + CARD.height / 2 }
    : { x: point.x + PILL.width, y: point.y + PILL.height / 2 };
}

function linkRows(layer: LayerDef): { row: TransitionDef; index: number; anyState: boolean }[] {
  return [
    ...layer.transitions.map((row, index) => ({ row, index, anyState: false })),
    ...layer.anyState.map((row, index) => ({ row, index, anyState: true })),
  ];
}

export function GraphCanvas({ layer }: { layer: LayerDef }) {
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
  const [connecting, setConnecting] = useState<{ from: string; origin: Point; at: Point } | null>(
    null,
  );
  const dragRef = useRef<{ keys: Record<string, Point>; origin: Point; start: Point } | null>(null);
  const panRef = useRef<{ origin: Point; start: Point } | null>(null);

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

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag != null && Object.keys(dragging).length > 0) moveNodes(dragging);
    dragRef.current = null;
    setDragging({});
    setConnecting(null);
  };

  const onWheel = (event: ReactWheelEvent) => {
    event.preventDefault();
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
    event.currentTarget.setPointerCapture?.(event.pointerId);
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

  return (
    <svg
      ref={surface}
      className="ed-graph"
      onWheel={onWheel}
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
          setDragging(next);
          return;
        }
        const origin = panRef.current;
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
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={(event) => {
        if ((event.target as Element).closest(".ed-node, .ed-pill, .ed-link") != null) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
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
      <g transform={`translate(${String(pan.x)} ${String(pan.y)}) scale(${String(zoom)})`}>
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
                {
                  x: entryPoint.x + PILL.width,
                  y: entryPoint.y + PILL.height / 2 - CARD.height / 2,
                },
                { x: toPoint.x, y: toPoint.y },
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
          const to = { x: toPoint.x, y: toPoint.y + CARD.height / 2 };
          const selected =
            selection?.kind === "transition" &&
            isTransition(selection, layer.id, index) &&
            selection.from === row.from;
          return (
            <path
              key={`${row.from}->${row.to}:${String(index)}:${String(anyState)}`}
              className="ed-link"
              data-any={anyState ? "true" : undefined}
              data-selected={selected ? "true" : undefined}
              d={linkPath(from, to)}
              onPointerDown={(event) => {
                event.stopPropagation();
                select({
                  kind: "transition",
                  layer: layer.id,
                  from: row.from,
                  to: row.to,
                  index,
                });
              }}
              onPointerEnter={() =>
                hover({ kind: "transition", layer: layer.id, from: row.from, to: row.to, index })
              }
            />
          );
        })}
        {connecting == null ? null : (
          <path
            className="ed-link ed-link--draft"
            d={linkPath(
              { x: connecting.origin.x, y: connecting.origin.y - CARD.height / 2 },
              { x: connecting.at.x - CARD.width, y: connecting.at.y - CARD.height / 2 },
            )}
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
        {/* A pointer released on a card ends a connection; the layer's own rule validates it. */}
        {connecting == null
          ? null
          : layer.states.map((state) => {
              const point = pointOf(
                stateKey(layer.id, state.id),
                cardOf(layout, stateKey(layer.id, state.id)),
              );
              return (
                <rect
                  key={`drop-${state.id}`}
                  className="ed-drop"
                  x={point.x}
                  y={point.y}
                  width={CARD.width}
                  height={CARD.height}
                  rx={CARD.radius}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    try {
                      addTransition(layer.id, connecting.from, state.id);
                    } finally {
                      setConnecting(null);
                    }
                  }}
                />
              );
            })}
      </g>
    </svg>
  );
}

/** The layer the graph draws: the selected one, else the first. */
export function useGraphLayer(): LayerDef {
  const definition: MachineDefinition = useEditorStore((state) => state.definition);
  const fileLayer = useEditorStore((state) => state.file.debug.selectedLayer);
  return definition.layers.find((layer) => layer.id === fileLayer) ?? definition.layers[0]!;
}
