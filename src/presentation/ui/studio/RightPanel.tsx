/**
 * The right column: the selected object's props, and the tools that used to live in a floating
 * dock.
 *
 * Two tabs rather than one scrolled column, because they answer different questions and one of
 * them is a form: *what does this object's rig say* (properties) and *what can I do to the scene*
 * (tools). Putting the shape spawner under the property list made every prop edit require a scroll
 * past six buttons that change what happens on the canvas.
 *
 * Writes are `writeProp` — a Studio transaction, which keyframes a sequenced prop at the playhead.
 * That is the whole point of the object inspector: a number you type here is a keyframe, not a
 * static override, so it shows up on the timeline two panels to the left.
 */

import { useState } from "react";

import type { IStudio } from "@theatre/studio";
import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import type { ShapeKind } from "@core/models/shapes.ts";
import type { SheetId } from "@infra/theatre/project.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";
import AstroPane from "@presentation/canvas/studio/tools/AstroPane.tsx";

import type { ISheet } from "./theatreView.ts";
import { ShaderPanel } from "./ShaderPanel.tsx";
import { liveValue, staticValues, trackRows, writeProp } from "./theatreView.ts";

export function RightPanel({
  sheet,
  sheetId,
  studio,
  sequenceLength,
  definition,
  onStatus,
}: {
  sheet: ISheet;
  sheetId: string;
  studio: IStudio | null;
  sequenceLength: number;
  definition: MachineDefinition;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<"properties" | "shaders" | "tools">("properties");
  const selected = useSceneStore((state) => state.selectedNodeId);

  return (
    <div className="st-right">
      <div className="ed-header__tabs st-tabs">
        <button
          type="button"
          className="ed-tab"
          data-active={tab === "properties"}
          onClick={() => {
            setTab("properties");
          }}
        >
          Properties
        </button>
        <button
          type="button"
          className="ed-tab"
          data-active={tab === "shaders"}
          onClick={() => {
            setTab("shaders");
          }}
        >
          Shaders
        </button>
        <button
          type="button"
          className="ed-tab"
          data-active={tab === "tools"}
          onClick={() => {
            setTab("tools");
          }}
        >
          Tools
        </button>
      </div>

      {tab === "properties" ? (
        <ObjectProperties
          sheet={sheet}
          sheetId={sheetId}
          studio={studio}
          objectKey={selected}
          onStatus={onStatus}
        />
      ) : tab === "shaders" ? (
        <ShaderPanel definition={definition} onStatus={onStatus} />
      ) : (
        <ToolsTab sheet={sheet} sheetId={sheetId} sequenceLength={sequenceLength} />
      )}
    </div>
  );
}

function ObjectProperties({
  sheet,
  sheetId,
  studio,
  objectKey,
  onStatus,
}: {
  sheet: ISheet;
  sheetId: string;
  studio: IStudio | null;
  objectKey: string | null;
  onStatus: (message: string) => void;
}) {
  if (objectKey == null) {
    return (
      <div className="ed-inspector__empty">
        <p className="ed-empty">
          Select an object on the left, or in the scene. Its props appear here, editable and
          keyframeable at the playhead.
        </p>
      </div>
    );
  }

  const rows = trackRows(sheetId, studio).filter((row) => row.objectKey === objectKey);
  const statics = staticValues(sheetId, objectKey, studio);

  /* The live object is the authority on what exists; the state file fills in what it has. */
  const paths = new Set<string>([...Object.keys(statics), ...rows.map((row) => row.path)]);
  const ordered = [...paths].sort();

  return (
    <div className="st-props">
      <header className="st-props__head">
        <strong>{objectKey}</strong>
        <span className="ed-mono">{ordered.length} props</span>
      </header>

      {ordered.length === 0 ? (
        <p className="ed-empty">
          No props recorded for “{objectKey}”. Keyframe it once in the Studio and they show up here.
        </p>
      ) : null}

      {ordered.map((path) => {
        const live = liveValue(sheet, objectKey, path);
        const stored = statics[path];
        const value = live ?? (typeof stored === "number" ? stored : undefined);
        const keyframed = rows.some((row) => row.path === path);
        return (
          <label key={path} className="st-prop">
            <span className="st-prop__name" title={path}>
              {path}
              {keyframed ? <span className="st-prop__kf">◆</span> : null}
            </span>
            <input
              className="ed-input st-prop__input"
              type="number"
              step="0.01"
              value={typeof value === "number" ? value : ""}
              placeholder={live == null ? "not on sheet" : ""}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                const result = writeProp(studio, sheet, objectKey, path, next);
                if (!result.ok) onStatus(result.reason);
              }}
            />
            <button
              type="button"
              className="st-icon"
              title="Keyframe at the playhead"
              onClick={() => {
                const at = liveValue(sheet, objectKey, path);
                if (at == null) {
                  onStatus(`No live value for ${objectKey}.${path}.`);
                  return;
                }
                const result = writeProp(studio, sheet, objectKey, path, at);
                onStatus(
                  result.ok
                    ? `Keyframed ${objectKey}.${path} at ${sheet.sequence.position.toFixed(2)}s`
                    : result.reason,
                );
              }}
            >
              ◆
            </button>
          </label>
        );
      })}

      <p className="st-props__hint">
        Typing a number writes through the Studio, so a sequenced prop becomes a keyframe at the
        playhead. The Studio&apos;s own Save is what persists it.
      </p>
    </div>
  );
}

const NO_SHAPES: never[] = [];

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "cube", label: "Cube" },
  { kind: "sphere", label: "Sphere" },
  { kind: "flat-square", label: "Plane" },
  { kind: "flat-circle", label: "Circle" },
];

function ToolsTab({
  sheet,
  sheetId,
  sequenceLength,
}: {
  sheet: ISheet;
  sheetId: string;
  sequenceLength: number;
}) {
  const addShape = useShapeStore((state) => state.addShape);
  const setSheetId = useShapeStore((state) => state.setSheetId);
  const setActiveScene = useSceneStore((state) => state.setActiveScene);
  const setStatus = useEditorStore((state) => state.setStatus);
  /*
   * Subscribe to the *record*, not to `state.shapes[sheetId] ?? []`: the fallback is a new array
   * on every snapshot call, which React 19 turns into "The result of getSnapshot should be
   * cached" and then an unbounded render loop — the black screen the Tools tab used to cause.
   */
  const shapesBySheet = useShapeStore((state) => state.shapes);
  const shapes = shapesBySheet[sheetId] ?? NO_SHAPES;

  return (
    <div className="st-tools">
      <section className="st-section">
        <h3 className="st-section__title">Spawn</h3>
        <div className="st-tools__grid">
          {SHAPES.map((shape) => (
            <button
              key={shape.kind}
              type="button"
              className="ed-btn"
              onClick={() => {
                setSheetId(sheetId as SheetId);
                setActiveScene(useSceneStore.getState().activeScene);
                const spawned = addShape(shape.kind);
                setStatus(`Spawned ${spawned.theatreKey} on ${sheetId}`);
              }}
            >
              + {shape.label}
            </button>
          ))}
        </div>
        <p className="ed-empty">
          Spawned shapes are Theatre-editable on this sheet; rig them here or in the Studio, and
          they ship with it.
        </p>
        {shapes.length === 0 ? null : (
          <ul className="st-list">
            {shapes.map((shape) => (
              <li key={shape.theatreKey} className="st-row">
                <span className="st-dot" />
                <span className="st-row__label">{shape.theatreKey}</span>
                <span className="st-row__meta">{shape.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="st-section">
        <h3 className="st-section__title">Character</h3>
        <AstroPane />
      </section>

      <section className="st-section">
        <h3 className="st-section__title">Sheet</h3>
        <p className="ed-mono">{sheetId}</p>
        <p className="ed-mono">
          sequence {sequenceLength.toFixed(2)}s · position {sheet.sequence.position.toFixed(2)}s
        </p>
      </section>
    </div>
  );
}
