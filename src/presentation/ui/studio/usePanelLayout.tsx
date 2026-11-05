/**
 * Panel sizes, with the drag that changes them.
 *
 * Three panels are resizable (left column, right column, bottom split) and all three want the
 * same three behaviours: a sensible default, a clamp that keeps the centre panel usable, and a
 * value that survives a reload. One hook for the three, because a per-panel implementation is
 * how the three get different clamps and one of them ends up able to hide the canvas.
 *
 * The values are px, not fractions: a fraction of the *window* makes the panel jump every time
 * the window resizes, and the thing a person is arranging is a panel, not a percentage of a
 * monitor they may drag between screens.
 */

import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

export type PanelKey = "left" | "right" | "bottom" | "preview";

export type PanelSizes = Record<PanelKey, number>;

const STORE_KEY = "astro.studio.panels";

const DEFAULTS: PanelSizes = { left: 260, right: 330, bottom: 340, preview: 220 };

/** Below these the panel is a sliver that no longer says what it is. */
export const PANEL_LIMITS: Record<PanelKey, { min: number; max: number }> = {
  left: { min: 180, max: 560 },
  right: { min: 240, max: 620 },
  bottom: { min: 120, max: 620 },
  /* The preview is the camera; below ~120 px it stops being a camera and becomes a strip. */
  preview: { min: 120, max: 640 },
};

function clamp(key: PanelKey, value: number): number {
  const limit = PANEL_LIMITS[key];
  return Math.round(Math.min(limit.max, Math.max(limit.min, value)));
}

function read(): PanelSizes {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw == null) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PanelSizes>;
    return {
      left: clamp("left", parsed.left ?? DEFAULTS.left),
      right: clamp("right", parsed.right ?? DEFAULTS.right),
      bottom: clamp("bottom", parsed.bottom ?? DEFAULTS.bottom),
      preview: clamp("preview", parsed.preview ?? DEFAULTS.preview),
    };
  } catch {
    return DEFAULTS;
  }
}

export function usePanelSizes() {
  const [sizes, setSizes] = useState<PanelSizes>(read);

  /* Written on every change, not on unmount: a tab closed mid-drag still keeps its layout. */
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(sizes));
    } catch {
      /* The layout is a convenience, never a reason to fail an edit. */
    }
  }, [sizes]);

  return {
    sizes,
    resize: (key: PanelKey, delta: number) => {
      setSizes((current) => ({ ...current, [key]: clamp(key, current[key] + delta) }));
    },
    set: (key: PanelKey, value: number) => {
      setSizes((current) => ({ ...current, [key]: clamp(key, value) }));
    },
    reset: () => {
      setSizes(DEFAULTS);
    },
  };
}

/**
 * One drag handle.
 *
 * `axis: "x"` moves the left/right column (drag right grows the left panel, drag left grows the
 * right one — the caller passes the sign), `axis: "y"` moves the bottom split. Pointer capture
 * lives on the handle itself, so the drag keeps tracking over the canvas, which is the element
 * under the pointer for most of a column drag.
 */
export function Splitter({
  axis,
  onResize,
  label,
  onDoubleClick,
}: {
  axis: "x" | "y";
  onResize: (delta: number) => void;
  label: string;
  onDoubleClick?: () => void;
}) {
  const last = useRef(0);
  return (
    <button
      type="button"
      className={`st-split st-split--${axis}`}
      aria-label={label}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 8;
        if (axis === "x" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          onResize(event.key === "ArrowLeft" ? -step : step);
        }
        if (axis === "y" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          onResize(event.key === "ArrowUp" ? -step : step);
        }
      }}
      onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
        last.current = axis === "x" ? event.clientX : event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const at = axis === "x" ? event.clientX : event.clientY;
        const delta = at - last.current;
        if (delta === 0) return;
        last.current = at;
        onResize(delta);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
