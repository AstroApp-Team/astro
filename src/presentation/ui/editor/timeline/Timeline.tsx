/**
 * The bottom half: the clip the selected state plays, and what the machine is doing right now.
 *
 * The ruler is a real duration from the timeline when the state references one, and a
 * placeholder "unknown" strip when it does not — inventing a duration would make an empty
 * clip look authored, which is the one lie a timeline can tell (§7.4).
 *
 * The telemetry lane is read-only on purpose. A live value is an observation; an editable one
 * would be a second way to write an input, and the sidebar is already that.
 */

import type { LayerDef, MachineDefinition } from "@core/models/animationStateMachine.ts";
import { clipIdOf, findState } from "@core/usecases/animationStateMachine/editorOps.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useMachineStore } from "@presentation/state/useMachineStore.ts";

function MarkerRuler({
  duration,
  markers,
}: {
  duration: number | null;
  markers: { time: number; name: string }[];
}) {
  if (duration == null) {
    return (
      <div className="ed-ruler ed-ruler--unknown">No clip — nothing to place a marker on.</div>
    );
  }
  return (
    <div className="ed-ruler">
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
        <span
          key={String(fraction)}
          className="ed-ruler__tick"
          style={{ left: `${String(fraction * 100)}%` }}
        >
          {(duration * fraction).toFixed(2)}
        </span>
      ))}
      {markers.map((marker) => (
        <span
          key={`${marker.name}-${String(marker.time)}`}
          className="ed-ruler__marker"
          style={{ left: `${String((marker.time / Math.max(duration, 0.001)) * 100)}%` }}
          title={`${marker.name} @ ${marker.time.toFixed(2)}s`}
        />
      ))}
    </div>
  );
}

function Telemetry() {
  const active = useMachineStore((store) => store.active);
  const events = useMachineStore((store) => store.events);
  const frames = useMachineStore((store) => store.frames);
  const error = useMachineStore((store) => store.error);

  return (
    <div className="ed-telemetry">
      <div className="ed-telemetry__row">
        <span className="ed-field__label">frames</span>
        <span className="ed-mono">{frames}</span>
      </div>
      {active.length === 0 ? (
        <p className="ed-empty">No active layer — the machine is stopped or has not stepped.</p>
      ) : null}
      {active.map((row) => (
        <div className="ed-telemetry__row" key={row.layer}>
          <span className="ed-field__label">{row.layer}</span>
          <span className="ed-mono">{row.state}</span>
          <span className="ed-bar">
            <span className="ed-bar__fill" style={{ width: `${String(row.progress * 100)}%` }} />
          </span>
          <span className="ed-mono">{row.speed.toFixed(2)}×</span>
        </div>
      ))}
      {events.slice(-4).map((line, index) => (
        <p className="ed-empty ed-mono" key={`${String(line.at)}-${String(index)}`}>
          {line.text}
        </p>
      ))}
      {error == null ? null : <p className="ed-header__error">{error}</p>}
    </div>
  );
}

export function Timeline({
  definition,
  layer,
  selection,
}: {
  definition: MachineDefinition;
  layer: LayerDef;
  selection: ReturnType<typeof useEditorStore.getState>["selection"];
}) {
  const stateId =
    selection?.kind === "state" && selection.layer === layer.id ? selection.state : null;
  const state = stateId == null ? null : findState(definition, layer.id, stateId);
  const clip =
    state == null
      ? null
      : (("timeline" in state ? (state.timeline ?? state.clip ?? state.morphCurve) : null) ??
        clipIdOf(state));
  const timelineId = state != null && "timeline" in state ? state.timeline : null;
  const timeline =
    timelineId == null ? undefined : definition.timelines?.find((row) => row.id === timelineId);
  const duration = timeline?.duration ?? null;
  const markers = timeline?.markers ?? state?.markers ?? [];

  return (
    <section className="ed-timeline" aria-label="Timeline and telemetry">
      <header className="ed-timeline__head">
        <span className="ed-field__label">timeline</span>
        <span className="ed-mono">{clip ?? "no clip"}</span>
        {duration == null ? null : (
          <span className="ed-row__meta">
            {duration.toFixed(2)}s · {timeline?.playStyle.kind ?? "once"}
          </span>
        )}
      </header>
      <MarkerRuler duration={duration} markers={markers} />
      <Telemetry />
    </section>
  );
}
