import { useEffect, useRef } from "react";

import type { ShapeKind, ShapeSpec } from "@core/models/shapes.ts";
import { SHAPE_MENU } from "@core/models/shapes.ts";

/**
 * The custom context menu "Add Shape" opens.
 *
 * It is a plain React tree rendered through a portal host in the light DOM (see
 * `shapeMenuController.ts`), not a Theatre.js component. Two reasons, both
 * load-bearing:
 *
 *   1. The Studio lives in a **shadow root** (`#theatrejs-studio-root` calls
 *      `attachShadow({mode:'open'})`). App CSS does not reach inside it, so a
 *      menu rendered there is unstyled unless the stylesheet travels with it.
 *      The light DOM is our own document: `studio.css` applies, and the app's
 *      design tokens apply.
 *   2. Stacking. The Studio root is `position: fixed; z-index: 100`, and the
 *      `z-index: 10000` menus inside it are scoped to that root's stacking
 *      context — they cannot out-rank a light-DOM element with `z-index > 100`.
 *      So the overlay sits at 10001 in the light DOM and is genuinely above the
 *      whole Studio, including its own flyouts.
 *
 * Theatre's built-in `Flyout` tool config is the zero-DOM alternative (it renders
 * inside the toolbar); this is the version that can show a live shape count, a
 * colour swatch and a keyboard-navigable list, which a `Flyout` item — a label
 * and a callback — cannot.
 */
export type ShapeMenuProps = {
  onPick: (kind: ShapeKind) => void;
  onClose: () => void;
};

export default function ShapeMenu({ onPick, onClose }: ShapeMenuProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  /**
   * Keyboard nav, because this opens from a toolbar button the hand is already
   * on. `ArrowDown` from the trigger lands on the first item; `Escape` closes.
   */
  useEffect(() => {
    const list = listRef.current;
    if (list == null) return;

    const items = () =>
      Array.from(list.querySelectorAll<HTMLButtonElement>("button[role='menuitem']"));

    const first = items()[0];
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        // Keep the tab loop inside the menu; the Studio's own shortcuts live on
        // the document, and a Tab that reaches them mid-menu is a lost menu.
        event.preventDefault();
        const all = items();
        const at = all.findIndex((node) => node === document.activeElement);
        const next = event.shiftKey ? at - 1 : at + 1;
        const index = all.length === 0 ? -1 : ((next % all.length) + all.length) % all.length;
        (all[index] ?? all[0])?.focus();
        return;
      }
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }

      event.preventDefault();
      const all = items();
      if (all.length === 0) return;

      const current = all.findIndex((node) => node === document.activeElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? all.length - 1
            : event.key === "ArrowDown"
              ? Math.min(current + 1, all.length - 1)
              : Math.max(current - 1, 0);

      all[nextIndex]?.focus();
    };

    list.addEventListener("keydown", onKeyDown);
    return () => list.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="astro-menu" role="menu" aria-label="Add Shape" ref={listRef}>
      <div className="astro-menu__header">
        <span>Add Shape</span>
        <button type="button" className="astro-menu__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="astro-menu__list">
        {SHAPE_MENU.map((spec) => (
          <button
            key={spec.kind}
            type="button"
            role="menuitem"
            className="astro-menu__item"
            onClick={() => {
              onPick(spec.kind);
              onClose();
            }}
          >
            <ShapeGlyph spec={spec} />
            <span className="astro-menu__label">{spec.label}</span>
            <span className="astro-menu__hint">{spec.flat ? "flat · XZ" : "solid"}</span>
          </button>
        ))}
      </div>

      <p className="astro-menu__foot">
        Spawns an <code>editable.mesh</code> — it lands in the outliner, ready for a stopwatch.
      </p>
    </div>
  );
}

/** 18px inline glyphs. Inline SVG so the menu needs no icon dependency. */
function ShapeGlyph({ spec }: { spec: ShapeSpec }) {
  const stroke = "#7dd3fc";

  if (spec.geometry === "box") {
    return (
      <svg viewBox="0 0 24 24" className="astro-menu__glyph" aria-hidden="true">
        <path d="M4 8l8-4 8 4v8l-8 4-8-4z" fill="none" stroke={stroke} strokeWidth="1.5" />
        <path d="M4 8l8 4 8-4M12 12v8" fill="none" stroke={stroke} strokeWidth="1.5" />
      </svg>
    );
  }

  if (spec.geometry === "sphere") {
    return (
      <svg viewBox="0 0 24 24" className="astro-menu__glyph" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke={stroke} strokeWidth="1.5" />
        <ellipse cx="12" cy="12" rx="8" ry="3.4" fill="none" stroke={stroke} strokeWidth="1.1" />
      </svg>
    );
  }

  if (spec.geometry === "plane") {
    return (
      <svg viewBox="0 0 24 24" className="astro-menu__glyph" aria-hidden="true">
        <path d="M3 12l9-5 9 5-9 5z" fill="none" stroke={stroke} strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="astro-menu__glyph" aria-hidden="true">
      <ellipse cx="12" cy="12" rx="9" ry="4.6" fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
