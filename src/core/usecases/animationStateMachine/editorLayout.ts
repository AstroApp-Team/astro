/**
 * Auto-layout: the graph's "Arrange" button, computed from the transitions.
 *
 * Determinism is the requirement, not prettiness (§4.4): the same definition must land in the
 * same place, or every screenshot review is guesswork. So the rank is a *longest path from
 * the entry states*, ties are broken by state id, and nothing reads `Math.random` or the wall
 * clock.
 */

import type { LayerDef, MachineDefinition, StateDef } from "@core/models/animationStateMachine.ts";
import type { NodePoint } from "@core/models/animationStateMachineEditor.ts";

import { stateKey, systemKey } from "@core/usecases/animationStateMachine/editorOps.ts";

/** Graph-space geometry. A card is 180 wide, so a column is 220 apart and a row 132. */
export const LAYOUT = {
  columnGap: 232,
  rowGap: 132,
  originX: 48,
  /* 120, not 48: the entry and any pills sit one offset *above* the first row, and at
     `originY: 48` that offset lands at a negative y — off the top of an unpanned canvas,
     where a pill exists but cannot be seen or clicked. */
  originY: 120,
  /** System pills stack above the first row of states. */
  systemOffsetY: -64,
  exitExtraColumns: 1,
} as const;

function ranksFor(layer: LayerDef): Map<string, number> {
  const ids = layer.states.map((state) => state.id).sort((a, b) => a.localeCompare(b));
  const ranks = new Map<string, number>(ids.map((id) => [id, 0]));
  const edges = [...layer.transitions, ...layer.anyState].filter(
    (edge) => edge.from !== edge.to && ranks.has(edge.from) && ranks.has(edge.to),
  );

  /*
   * Kahn's algorithm, then a longest path on the peeled order.
   *
   * A relaxation loop (the obvious version) raises a cycle's ranks once per pass and the
   * answer depends on the pass cap — "bounded" but arbitrary, which is the one thing §4.4
   * forbids. Peeling visits only acyclic nodes, so a state inside a cycle keeps the rank its
   * acyclic predecessors gave it and the layout is stable everywhere else.
   */
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);

  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (id == null) break;
    order.push(id);
    for (const edge of edges) {
      if (edge.from !== id) continue;
      const left = (indegree.get(edge.to) ?? 1) - 1;
      indegree.set(edge.to, left);
      if (left === 0) ready.push(edge.to);
    }
  }

  for (const id of order) {
    for (const edge of edges) {
      if (edge.from !== id) continue;
      ranks.set(edge.to, Math.max(ranks.get(edge.to) ?? 0, (ranks.get(id) ?? 0) + 1));
    }
  }

  /* Entry targets start at column 0 even when something points back at them: the author
     declared them reachable from nothing, and a layout that buries them is a maze. */
  for (const row of layer.entry) ranks.set(row.to, 0);
  return ranks;
}

function orderFor(layer: LayerDef, ranks: Map<string, number>): StateDef[] {
  return [...layer.states].sort((a, b) => {
    const rankA = ranks.get(a.id) ?? 0;
    const rankB = ranks.get(b.id) ?? 0;
    return rankA === rankB ? a.id.localeCompare(b.id) : rankA - rankB;
  });
}

export interface LayerLayout {
  nodes: Record<string, NodePoint>;
  systemNodes: Record<string, NodePoint>;
}

/** Positions for one layer's cards and its three system pills. */
export function layoutLayer(layer: LayerDef): LayerLayout {
  const ranks = ranksFor(layer);
  const ordered = orderFor(layer, ranks);
  const rowsInColumn = new Map<number, number>();
  const nodes: Record<string, NodePoint> = {};

  for (const state of ordered) {
    const rank = ranks.get(state.id) ?? 0;
    const row = rowsInColumn.get(rank) ?? 0;
    rowsInColumn.set(rank, row + 1);
    nodes[stateKey(layer.id, state.id)] = {
      x: LAYOUT.originX + rank * LAYOUT.columnGap,
      y: LAYOUT.originY + row * LAYOUT.rowGap,
    };
  }

  const columns = Math.max(0, ...ordered.map((state) => ranks.get(state.id) ?? 0));
  const systemNodes: Record<string, NodePoint> = {
    [systemKey(layer.id, "entry")]: {
      x: LAYOUT.originX,
      y: LAYOUT.originY + LAYOUT.systemOffsetY,
    },
    [systemKey(layer.id, "any")]: {
      x: LAYOUT.originX + LAYOUT.columnGap * 0.5,
      y: LAYOUT.originY + LAYOUT.systemOffsetY,
    },
    [systemKey(layer.id, "exit")]: {
      x: LAYOUT.originX + (columns + LAYOUT.exitExtraColumns) * LAYOUT.columnGap,
      y: LAYOUT.originY,
    },
  };
  return { nodes, systemNodes };
}

/** Every layer at once, for the "All" pseudo-tab (§6.A): one band per layer. */
export function layoutDefinition(definition: MachineDefinition): LayerLayout {
  const nodes: Record<string, NodePoint> = {};
  const systemNodes: Record<string, NodePoint> = {};
  const ordered = [...definition.layers].sort((a, b) => b.priority - a.priority);
  ordered.forEach((layer, band) => {
    const layout = layoutLayer(layer);
    const bandOffset = band * LAYOUT.rowGap * 3;
    for (const [key, point] of Object.entries(layout.nodes)) {
      nodes[key] = { x: point.x, y: point.y + bandOffset };
    }
    for (const [key, point] of Object.entries(layout.systemNodes)) {
      systemNodes[key] = { x: point.x, y: point.y + bandOffset };
    }
  });
  return { nodes, systemNodes };
}

/**
 * Where a node goes when the editor file has no entry for it.
 *
 * A missing entry is not a bug (§4.4) — a new state has never been positioned — so the graph
 * asks for a position and writes it back on the next drag. Keeping the fallback deterministic
 * is what stops a reload from shuffling the cards the user has not touched yet.
 */
export function fallbackPoint(
  definition: MachineDefinition,
  layerId: string,
  nodeId: string,
): NodePoint {
  const layer = definition.layers.find((row) => row.id === layerId);
  if (layer == null) return { x: LAYOUT.originX, y: LAYOUT.originY };
  const layout = layoutLayer(layer);
  return (
    layout.nodes[nodeId] ?? layout.systemNodes[nodeId] ?? { x: LAYOUT.originX, y: LAYOUT.originY }
  );
}
