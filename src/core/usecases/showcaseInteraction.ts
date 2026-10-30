import type { SpawnedShape } from "@core/models/shapes.ts";

/**
 * The rules an integrated (non-editing) page needs on top of a Theatre scene.
 *
 * Pure TypeScript, like the rest of `core/`: no Theatre, no three, no DOM, no
 * `Math.random()` baked in. The page passes `Math.random` in at the call site,
 * so these stay deterministic under test — the same reason `trackVoiceUsage`
 * takes a clock port.
 *
 * All three functions answer a question the *page* cannot answer by itself:
 *
 *   - "is the thing I just clicked a shape the Studio spawned, or a prefab the
 *     code mounted?" — only `useShapeStore` knows, and the page must not import
 *     the store to ask, so the predicate takes the array.
 *   - "what range do I replay?" — a sheet nobody has rigged has length 0, and
 *     `sequence.play({range: [0, 0]})` throws. The guard belongs here.
 *   - "what colour should the button be?" — a colour the user can read on a dark
 *     stage, which is a constraint, which is a rule, which is a function.
 */

/**
 * The button's resting colour: the same sky the prefabs use when selected
 * (`#38bdf8`), so the button starts in the scene's palette and only leaves it
 * when a shape click pushes it out.
 */
export const DEFAULT_ACCENT = "hsl(199 89% 60%)";

/**
 * Saturation and lightness are fixed; only the hue is random.
 *
 * A fully random colour is a colour that lands on `hsl(60 90% 92%)` and renders
 * white text on a near-white button. Locking S and L to a mid band keeps every
 * draw usable on the dark stage, and leaves the one axis the demo is about —
 * hue — free.
 */
const ACCENT_SATURATION = 72;
const ACCENT_LIGHTNESS = 56;

/**
 * A random hue as an `hsl()` string.
 *
 * `random` is a port, defaulting to `Math.random`: a test that wants a
 * reproducible colour passes a stub, a page passes nothing.
 */
export function randomAccentColor(random: () => number = Math.random): string {
  const raw = random();
  const hue = Math.floor(Math.min(Math.max(raw, 0), 0.999999) * 360);
  return `hsl(${hue} ${ACCENT_SATURATION}% ${ACCENT_LIGHTNESS}%)`;
}

/**
 * The spawned shape a raycast hit refers to, or null.
 *
 * Matching on `theatreKey` is the whole trick: the Studio's spawn writes that
 * key into `useShapeStore`, `SpawnedShapeMesh` writes the same key into
 * `useSceneStore.selectedNodeId` on pointer down, and so a page can tell "the
 * user clicked a shape that exists only because someone spawned it in the
 * Studio" from "the user clicked a prefab the code mounted" with no mapping
 * table between them.
 *
 * Prefabs are deliberately *not* matched — `Sting-Core` is in the scene's data
 * array, not in the shape store. A demo hook keyed on "dynamic" must stay keyed
 * on dynamic.
 */
export function findDynamicShape(
  shapes: readonly SpawnedShape[],
  nodeId: string | null,
): SpawnedShape | null {
  if (nodeId == null) return null;
  return shapes.find((shape) => shape.theatreKey === nodeId) ?? null;
}

/**
 * The range to replay, or null when there is nothing to replay.
 *
 * `ISequence.play()` validates its range and throws on `range[1] <= range[0]`,
 * so a sheet with no exported state — the normal state of a scene nobody has
 * rigged — must never reach it with `[0, 0]`.
 */
export function replayRange(length: number): [from: number, to: number] | null {
  if (!Number.isFinite(length) || length <= 0) return null;
  return [0, length];
}

/**
 * Whether the selected node should be *drawn* as selected.
 *
 * The highlight is rigging furniture. On a bench it is load-bearing — it is how
 * you see which object the Studio's stopwatch and the toolbar's readout are
 * aimed at. On an end-user page it is a debugging affordance leaking into the
 * scene: the user taps a sphere to make a button change colour, and a mesh that
 * changes colour on tap reads as "this is selectable", which is a promise the
 * page does not keep.
 *
 * So the switch is on the drawing, not on the selection. `selectNode()` still
 * runs and `selectedNodeId` still lands in the store — the page's own hook is
 * that write, and the rigging side's toolbar readout stays truthful. Clearing
 * the selection to hide the highlight would delete the signal the page is built
 * on.
 */
export function showsSelectionHighlight(
  selectionVisuals: boolean,
  selectedNodeId: string | null,
  theatreKey: string,
): boolean {
  return selectionVisuals && selectedNodeId === theatreKey;
}
