import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import type { IStudio } from "@theatre/studio";

import AstroPane from "@presentation/canvas/studio/tools/AstroPane.tsx";
import { mountMachinePane } from "@presentation/canvas/studio/machineTools/MachinePane.tsx";
import { mountShapePalettePane } from "@presentation/canvas/studio/shapeTools/ShapePalettePane.tsx";

import "@presentation/ui/styles/tools.css";

/**
 * The tools dashboard for the rig studio.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Every authoring tool this project has was, until now, only reachable through the
 * Theatre.js panel's own toolbar: `Shapes` and `Machine` are registered as
 * `toolbars.global` entries, and the richer panes open from a `panes[]` mount the
 * Studio owns. That makes the tools invisible in three separate ways — the Studio is
 * a floating overlay you have to toggle, it is dev-and-desktop only, and its chrome
 * lives in a shadow root that no app stylesheet can reach. On the rig bench, which is
 * *the* page where a clip gets rigged, the toolbar showed a canvas and a play button.
 *
 * So the tools get an app-level home: a dock that is always on the rig routes, lists
 * every panel by name, and mounts the same pane components into windows this shell
 * owns. The Studio keeps its own toolbar for the people who live in it; this is the
 * door for everyone else. It also means a panel survives the Studio failing to
 * initialise (it does, in ways that are invisible: the panel renders empty), and that
 * the panes are reachable on a phone-sized window where Theatre's chrome is unusable.
 *
 * ── What a "panel" is ───────────────────────────────────────────────────────
 *
 * A registry entry, not a component: `mount(node)` hands a DOM node to a pane and
 * returns a teardown. That is the same contract `IExtension.panes[].mount` has, so
 * the existing panes are reused verbatim rather than re-implemented, and a React
 * panel (`AstroPane`) simply renders into the same node. Windows are draggable and
 * stack in open order; closing one unmounts its React root, so a closed panel holds
 * no subscriptions.
 */

type PanelId = "scene-tools" | "machine" | "astro";

type PanelDefinition = {
  id: PanelId;
  title: string;
  summary: string;
  /** The pane's own mount contract; `null` renders `children` instead. */
  mount: ((node: HTMLElement) => () => void) | null;
  children?: ReactNode;
  /** Links to a route instead of opening a window. */
  href?: string;
};

const WINDOW_OFFSET = 28;

export default function ToolsDock({ studio }: { studio: IStudio | null }) {
  const [open, setOpen] = useState<PanelId[]>([]);
  const [minimised, setMinimised] = useState<PanelId[]>([]);

  const panels: PanelDefinition[] = [
    {
      id: "scene-tools",
      title: "Scene tools",
      summary: "spawn, aim, save",
      mount:
        studio == null ? null : (node) => mountShapePalettePane(node, studio, "tools-dock-scene"),
      children:
        studio == null ? (
          <p className="tools-empty">
            Scene tools need the Studio instance: they write through
            <code> studio.transaction()</code>. The Studio only loads in dev, on a desktop browser —
            this window is the reason the rest of the dock still works without it.
          </p>
        ) : null,
    },
    {
      id: "machine",
      title: "Machine",
      summary: "layers and clips",
      mount: (node) => mountMachinePane(node),
    },
    {
      id: "astro",
      title: "Character",
      summary: "face and look",
      mount: null,
      children: <AstroPane />,
    },
  ];

  function toggle(id: PanelId) {
    setOpen((current) => {
      if (current.includes(id)) {
        setMinimised((min) => min.filter((entry) => entry !== id));
        return current.filter((entry) => entry !== id);
      }
      return [...current, id];
    });
  }

  function minimise(id: PanelId) {
    setMinimised((min) => (min.includes(id) ? min : [...min, id]));
  }

  /**
   * Portal to `document.body`, and this is not cosmetic.
   *
   * An `IonContent` page is its own stacking context, so a `position: fixed` dock rendered
   * inside it competes at the *page's* z-index — where the Theatre.js root (`#theatrejs-studio-root`,
   * a body-level fixed overlay at `z-index: 100`) wins no matter how large the number on the
   * dock is. That is the bug this dock exists to fix, reproduced: the tabs were visible and
   * unclickable, with the Studio's empty overlay swallowing the presses. The body is the only
   * stacking context both of them share.
   */
  return createPortal(
    <div className="tools">
      <div className="tools__bar" role="toolbar" aria-label="Editing tools">
        <span className="tools__label">Tools</span>
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className="tools__tab"
            data-active={open.includes(panel.id) && !minimised.includes(panel.id)}
            aria-pressed={open.includes(panel.id) && !minimised.includes(panel.id)}
            title={`${panel.title} — ${panel.summary}`}
            onClick={() => {
              toggle(panel.id);
            }}
          >
            {panel.title}
            <span className="tools__tab-count">{panel.summary}</span>
          </button>
        ))}
        <Link className="tools__tab tools__tab--link" to="/editor?editor" target="_blank">
          Editor ↗
        </Link>
        <Link className="tools__tab tools__tab--link" to="/machine" target="_blank">
          Demo ↗
        </Link>
      </div>

      {panels
        .filter((panel) => open.includes(panel.id))
        .map((panel, index) => (
          <ToolsWindow
            key={panel.id}
            panel={panel}
            index={index}
            minimised={minimised.includes(panel.id)}
            onMinimise={() => {
              minimise(panel.id);
            }}
            onClose={() => {
              toggle(panel.id);
            }}
          />
        ))}
    </div>,
    document.body,
  );
}

function ToolsWindow({
  panel,
  index,
  minimised,
  onMinimise,
  onClose,
}: {
  panel: PanelDefinition;
  index: number;
  minimised: boolean;
  onMinimise: () => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef(panel.mount);
  mountRef.current = panel.mount;
  const [drag, setDrag] = useState({ x: 0, y: 0 });

  /**
   * The pane owns the node it is given, and the teardown is called on unmount — not on
   * every render.
   *
   * The dependency list is `[panel.id, hasMount]` and **not** `panel.mount`: the dock
   * rebuilds its registry on every render, so a function-identity dependency would tear
   * down and remount the pane whenever anything else re-rendered, and a pane that remounts
   * loses its scroll position and drops every store subscription mid-edit. The mount
   * itself is read from a ref, which is safe because the teardown closes over what it
   * mounted.
   */
  const hasMount = panel.mount != null;
  useEffect(() => {
    const host = hostRef.current;
    const mount = mountRef.current;
    if (host == null || mount == null) {
      return;
    }
    /* The pane appends its own stylesheet; the container is what React renders into. */
    return mount(host);
  }, [panel.id, hasMount]);

  return (
    <section
      className="tools-window"
      data-minimised={minimised}
      style={{
        transform: `translate(${-WINDOW_OFFSET * (index + 1) + drag.x}px, ${WINDOW_OFFSET * index + drag.y}px)`,
      }}
      aria-label={panel.title}
    >
      <header
        className="tools-window__head"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button") != null) {
            return;
          }
          const start = { x: event.clientX, y: event.clientY, dx: drag.x, dy: drag.y };
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const move = (moveEvent: PointerEvent) => {
            setDrag({
              x: start.dx + (moveEvent.clientX - start.x),
              y: start.dy + (moveEvent.clientY - start.y),
            });
          };
          const up = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", up);
          };
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", up);
        }}
      >
        <span className="tools-window__dot" />
        <h2 className="tools-window__title">{panel.title}</h2>
        <span className="tools-window__summary">{panel.summary}</span>
        <button
          type="button"
          className="tools-window__btn"
          aria-label={minimised ? `Expand ${panel.title}` : `Collapse ${panel.title}`}
          onClick={onMinimise}
        >
          {minimised ? "▾" : "▴"}
        </button>
        <button
          type="button"
          className="tools-window__btn"
          aria-label={`Close ${panel.title}`}
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      {minimised ? null : panel.mount == null ? (
        <div className="tools-window__body tools-window__body--react">{panel.children}</div>
      ) : (
        <div className="tools-window__body" ref={hostRef} />
      )}
    </section>
  );
}
