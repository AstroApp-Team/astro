import { createRoot, type Root } from "react-dom/client";

import type { ShapeKind } from "@core/models/shapes.ts";
import ShapeMenu from "@presentation/canvas/studio/shapeTools/ShapeMenu.tsx";

/**
 * The DOM overlay host for the "Add Shape" menu.
 *
 * Why a hand-rolled portal host and not `createPortal`: a portal renders into a
 * node that a React tree already owns. This menu is opened *from outside* React —
 * from a Theatre.js toolbar callback, which is a plain function the Studio calls
 * — so there is no enclosing tree to portal from. The host is created on demand,
 * given its own root, and torn down on close.
 *
 * Where it lands, and why:
 *
 *   - `document.body`, **not** the Studio's shadow root. The Studio mounts
 *     itself in `#theatrejs-studio-root` with `attachShadow({mode:'open'})`, so
 *     app CSS does not reach inside it. In the light DOM, `studio.css` applies.
 *   - `z-index: 10001`. The Studio root is `position: fixed; z-index: 100`, and
 *     the `z-index: 10000` menus inside it are trapped in that root's stacking
 *     context. In the light DOM, 10001 > 100, so this overlay is above the
 *     entire Studio panel, its flyouts included.
 *   - `pointer-events: auto` on the host. The Studio root is
 *     `pointer-events: none` and opts in per element; a host that inherits the
 *     "none" is a menu you can see and not click.
 */
const HOST_ID = "astro-shape-menu-host";
const HOST_Z_INDEX = 10001;

/** The Studio's global toolbar is 36px tall and pinned to the top of the root. */
const STUDIO_TOOLBAR_HEIGHT = 36;
const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;

export type ShapeMenuAnchor = { x: number; y: number; width: number; height: number };

export type ShapeMenuOptions = {
  /**
   * Rect to hang the menu under — pass the button that opened it.
   *
   * `null` means "no anchor": the Studio toolbar's own DOM is inside a shadow
   * root we do not own, so a tool opened from there gets the top-centre
   * placement under the toolbar instead.
   */
  anchor: ShapeMenuAnchor | null;
  onPick: (kind: ShapeKind) => void;
  onClose?: () => void;
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let detachGlobalHandlers: (() => void) | null = null;

/** True while the overlay is on screen. */
export function isShapeMenuOpen(): boolean {
  return host !== null;
}

/**
 * Open the menu.
 *
 * Opening again replaces the open menu rather than stacking a second one, so a
 * double-click on the toolbar button cannot leave two hosts on the page.
 */
export function openShapeMenu(options: ShapeMenuOptions): void {
  if (typeof document === "undefined") return;
  const body = document.body;
  if (body == null) return;

  closeShapeMenu();

  const node = document.createElement("div");
  node.id = HOST_ID;
  node.style.cssText = `position: fixed; z-index: ${HOST_Z_INDEX}; pointer-events: auto;`;
  body.appendChild(node);

  host = node;
  root = createRoot(node);
  root.render(<ShapeMenu onPick={options.onPick} onClose={closeShapeMenu} />);

  place(node, options.anchor);
  detachGlobalHandlers = attachDismissHandlers(node, closeShapeMenu);
  options.onClose?.();
}

/** Close the menu and tear the host down. Safe to call when nothing is open. */
export function closeShapeMenu(): void {
  detachGlobalHandlers?.();
  detachGlobalHandlers = null;

  const node = host;
  const reactRoot = root;
  host = null;
  root = null;

  if (reactRoot == null || node == null) return;

  // React 18+ warns when `unmount()` runs synchronously inside a React
  // lifecycle. This is called from a menu item's own onClick, which *is* inside
  // one, so the teardown goes on the next task.
  window.setTimeout(() => {
    reactRoot.unmount();
    node.remove();
  }, 0);
}

/** Convenience for the app-side toolbars: anchor to a real element. */
export function openShapeMenuFromElement(
  element: HTMLElement,
  onPick: (kind: ShapeKind) => void,
): void {
  const rect = element.getBoundingClientRect();
  openShapeMenu({
    anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    onPick,
  });
}

/**
 * Put the panel on screen.
 *
 * Anchored: under the anchor, clamped into the viewport. Unanchored: top-centre,
 * just below the Studio toolbar — the deterministic place a user learns to look.
 */
function place(node: HTMLElement, anchor: ShapeMenuAnchor | null): void {
  const { innerWidth, innerHeight } = window;

  node.style.left = "0px";
  node.style.top = "0px";
  node.style.transform = "none";

  const size = node.getBoundingClientRect();

  if (anchor == null) {
    // Top-centre under the Studio toolbar. `maxWidth` is what keeps it on screen
    // at 320px; the centring is a transform, so it needs no measurement.
    node.style.top = `${STUDIO_TOOLBAR_HEIGHT + MENU_GAP}px`;
    node.style.left = "50%";
    node.style.transform = "translateX(-50%)";
    node.style.maxWidth = `${Math.max(200, innerWidth - VIEWPORT_PADDING * 2)}px`;
    return;
  }

  const left = Math.min(
    Math.max(anchor.x, VIEWPORT_PADDING),
    Math.max(VIEWPORT_PADDING, anchor.x + anchor.width - size.width),
  );
  const below = anchor.y + anchor.height + MENU_GAP;
  const top =
    below + size.height > innerHeight - VIEWPORT_PADDING
      ? Math.max(VIEWPORT_PADDING, anchor.y - size.height - MENU_GAP)
      : below;

  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.transform = "none";
}

/**
 * Dismiss on anything that is not the menu: a click outside, `Escape`, a scroll
 * (an anchored menu would drift off its button), a resize.
 *
 * `pointerdown` in the capture phase, not `click`: the Studio swallows clicks on
 * its own chrome, and a menu that only closes on `click` stays open over a
 * drag in the sequence editor.
 */
function attachDismissHandlers(node: HTMLElement, onClose: () => void): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && node.contains(target)) return;
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };

  const onViewportChange = () => onClose();

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
  };
}
