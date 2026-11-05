/**
 * The Shaders tab: what each mesh on the canvas is wearing, the uniforms its shader exposes, and
 * the two edits a rig needs from here — swap the material, and change a uniform value.
 *
 * The list is read from the live scene (`useInspectStore`), never from the sheet: a mesh's material
 * is not a Theatre prop, and the astro v2 body/eyes/halo are three different `ShaderMaterial`s on
 * three different nodes. That is exactly the question this panel answers — "which shader is this
 * part using" — and it cannot be answered from the JSON.
 *
 * Uniform edits write straight to the material (the shader reads the uniform object, not React
 * state), which is why they are immediate and not undoable. Anything continuous belongs in the
 * machine: a uniform is a number the runtime can drive, so each one can be promoted to an input.
 */

import { useEffect } from "react";

import { SHADER_ENTRIES } from "@presentation/canvas/materialRegistry.ts";
import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import { useEditorStore } from "@presentation/state/useEditorStore.ts";
import { useInspectStore } from "@presentation/state/useInspectStore.ts";

export function ShaderPanel({
  definition,
  onStatus,
}: {
  definition: MachineDefinition;
  onStatus: (message: string) => void;
}) {
  const objects = useInspectStore((state) => state.objects);
  const imports = useInspectStore((state) => state.imports);
  const selectedUuid = useInspectStore((state) => state.selectedUuid);
  const overrides = useInspectStore((state) => state.overrides);
  const refresh = useInspectStore((state) => state.refresh);
  const select = useInspectStore((state) => state.select);
  const setOverride = useInspectStore((state) => state.setOverride);
  const setUniform = useInspectStore((state) => state.setUniform);
  const addImport = useInspectStore((state) => state.addImport);
  const removeImport = useInspectStore((state) => state.removeImport);
  const addInput = useEditorStore((state) => state.addInput);
  const renameInput = useEditorStore((state) => state.renameInput);
  const patchInput = useEditorStore((state) => state.patchInput);

  /* The first open of a tab is often the first moment the scene is queryable. */
  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = objects.find((object) => object.uuid === selectedUuid) ?? objects[0] ?? null;

  /** Promote a uniform to a machine input, so the runtime can drive it instead of a slider. */
  function promoteUniform(name: string, value: number | string) {
    const inputName = name.replace(/^u/, "");
    const taken = definition.inputs.some((input) => input.name === inputName);
    if (taken) {
      onStatus(`Input "${inputName}" already exists — drive it from the Inputs deck.`);
      return;
    }
    if (typeof value !== "number") {
      onStatus(
        `"${name}" is a colour: machine inputs are numbers. Keyframe the colour on the sheet (◆ on a colour track) instead.`,
      );
      return;
    }
    addInput("number");
    /* `addInput` names the input (`input-1`, …); the uniform's name is the useful one. */
    const created = definition.inputs.at(-1)?.name;
    if (created != null) {
      renameInput(created, inputName);
      patchInput(inputName, { value, default: value });
    }
    onStatus(`Added input "${inputName}" — it can now be driven by states and transitions.`);
  }

  return (
    <div className="st-props st-shaders">
      <div className="st-props__head">
        <strong>Shaders</strong>
        <span className="ed-mono">{objects.length} meshes</span>
      </div>

      <div className="st-shaders__list">
        {objects.map((object) => (
          <button
            key={object.uuid}
            type="button"
            className="st-shaders__row"
            data-active={selected?.uuid === object.uuid}
            onClick={() => {
              select(object.uuid);
            }}
          >
            <span className="st-shaders__name">{object.name}</span>
            <span className="st-shaders__mat">{object.materialType}</span>
            {object.keyed ? <span className="ed-badge">sheet</span> : null}
          </button>
        ))}
        {objects.length === 0 ? (
          <p className="ed-empty">No meshes on the canvas yet — open a scene first.</p>
        ) : null}
      </div>

      {selected == null ? null : (
        <>
          <div className="st-prop st-prop--block">
            <span className="st-prop__label">material</span>
            <select
              className="ed-input"
              value={overrides[selected.name] ?? selected.materialId}
              onChange={(event) => {
                setOverride(selected.name, event.target.value);
                onStatus(`${selected.name} → ${event.target.value}`);
              }}
            >
              <option value={selected.materialId}>{selected.materialType} (current)</option>
              {SHADER_ENTRIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          {selected.uniforms.length === 0 ? (
            <p className="ed-empty">
              {selected.materialType} exposes no uniforms. Swap it to a shader material to get any.
            </p>
          ) : (
            <div className="st-shaders__uniforms">
              {selected.uniforms.map((uniform) => (
                <div key={uniform.name} className="st-prop st-prop--block">
                  <span className="st-prop__label" title={uniform.name}>
                    {uniform.name}
                    <span className="st-prop__kind">{uniform.kind}</span>
                  </span>
                  <div className="st-shaders__value">
                    {uniform.kind === "number" ? (
                      <input
                        className="ed-input"
                        type="number"
                        step="0.01"
                        value={String(uniform.value)}
                        onChange={(event) => {
                          setUniform(selected.uuid, uniform.name, Number(event.target.value));
                        }}
                      />
                    ) : uniform.kind === "colour" ? (
                      <input
                        className="ed-input st-shaders__colour"
                        type="color"
                        value={String(uniform.value)}
                        onChange={(event) => {
                          setUniform(selected.uuid, uniform.name, event.target.value);
                        }}
                      />
                    ) : (
                      <span className="ed-mono st-shaders__readonly">{String(uniform.value)}</span>
                    )}
                    {uniform.kind === "number" ? (
                      <button
                        type="button"
                        className="ed-btn ed-btn--ghost"
                        title="Expose as a machine input so a state can drive it"
                        onClick={() => {
                          promoteUniform(uniform.name, uniform.value);
                        }}
                      >
                        → input
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="st-props__head">
        <strong>Imported meshes</strong>
        <span className="ed-mono">{imports.length}</span>
      </div>
      <label className="st-shaders__import">
        <input
          type="file"
          accept=".glb,.gltf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file == null) return;
            addImport(URL.createObjectURL(file), file.name.replace(/\.(glb|gltf)$/i, ""));
            onStatus(
              `Imported ${file.name} — it renders in every scene. It is not a sheet object, so it cannot be keyframed in the Studio.`,
            );
            event.target.value = "";
          }}
        />
        <span>Import a .glb / .gltf</span>
      </label>
      {imports.length === 0 ? (
        <p className="ed-empty">
          Blender → File → Export → glTF 2.0 (.glb). The file is uploaded into the page, not saved
          with the project.
        </p>
      ) : (
        <ul className="st-shaders__imports">
          {imports.map((item) => (
            <li key={item.id}>
              <span className="ed-mono">{item.name}</span>
              <button
                type="button"
                className="ed-btn ed-btn--ghost"
                onClick={() => {
                  removeImport(item.id);
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
