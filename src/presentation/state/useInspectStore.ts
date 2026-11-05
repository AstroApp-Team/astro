/**
 * Live introspection of whatever is on the canvas.
 *
 * The rig studio edits the *sheet* — Theatre objects and their tracks. Some of the things an author
 * needs to touch are not on the sheet at all: a `ShaderMaterial`'s uniforms, the material a mesh is
 * wearing, and meshes that were imported at runtime. This store is the one channel from the DOM
 * side of the studio into the live `THREE.Scene`, so a panel never has to find an object by
 * traversing the canvas itself.
 *
 * Two rules that make it work:
 *
 * - **`refresh()` is called after an effect, not during render.** The scene graph is built by
 *   Theatre and R3F after the first frame, so a list read during render is empty and stays empty.
 * - **Uniform writes go straight to the live `ShaderMaterial`.** A store round-trip would repaint a
 *   slider and change nothing on screen; the store only keeps the *value* so the next repaint shows
 *   it, and `rev` is the repaint trigger.
 */

import type * as THREE from "three";
import { create } from "zustand";

import { SHADER_ENTRIES } from "@presentation/canvas/materialRegistry.ts";

export type UniformInfo = {
  name: string;
  kind: "number" | "colour" | "vector" | "texture" | "other";
  /** Display value: number, `#rrggbb`, or a short string. Never a raw texture or matrix. */
  value: number | string;
};

export type InspectObject = {
  uuid: string;
  name: string;
  type: string;
  /** The material's constructor name — what the mesh is *wearing* right now. */
  materialType: string;
  materialId: string;
  uniforms: UniformInfo[];
  /** The object is on the sheet: it has a `theatreKey`, so keyframing can reach it. */
  keyed: boolean;
};

export type Imported = { id: string; url: string; name: string };

/** Live object references, deliberately outside React state — a `THREE.Mesh` is not serialisable. */
const liveObjects = new Map<string, THREE.Mesh>();
let liveRoot: THREE.Object3D | null = null;

function uniformKind(value: unknown): UniformInfo["kind"] {
  if (typeof value === "number") return "number";
  if (value != null && typeof value === "object") {
    const record = value as { isColor?: boolean; isVector2?: boolean; isVector3?: boolean };
    if (record.isColor === true) return "colour";
    if (record.isVector2 === true || record.isVector3 === true) return "vector";
    if ("isTexture" in value) return "texture";
  }
  return "other";
}

function uniformDisplay(value: unknown): UniformInfo["value"] {
  const kind = uniformKind(value);
  if (kind === "number") return Number((value as number).toFixed(4));
  if (kind === "colour") return `#${(value as THREE.Color).getHexString()}`;
  if (kind === "vector") {
    const vector = value as THREE.Vector3;
    return `${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}${vector.z === undefined ? "" : `, ${vector.z.toFixed(2)}`}`;
  }
  if (kind === "texture") return "texture";
  return typeof value === "object" ? "—" : String(value);
}

export function readUniforms(material: THREE.Material): UniformInfo[] {
  const shader = material as THREE.ShaderMaterial;
  if (!("uniforms" in material) || shader.uniforms == null) return [];
  return Object.entries(shader.uniforms).map(([name, entry]) => ({
    name,
    kind: uniformKind(entry.value),
    value: uniformDisplay(entry.value),
  }));
}

/** The registry id of whatever a material is, so the dropdown shows the truth, not the last pick. */
function materialIdOf(material: THREE.Material | undefined): string {
  if (material == null) return "";
  for (const entry of SHADER_ENTRIES) {
    if (material === entry.probe()) return entry.id;
  }
  if (material.type === "ShaderMaterial") return "custom";
  return material.type
    .replace(/Material$/, "")
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

type InspectState = {
  /** Bumped whenever the panel should re-read the scene. */
  rev: number;
  objects: InspectObject[];
  selectedUuid: string | null;
  imports: Imported[];
  /**
   * `objectName → registry id`, applied by `SceneIntrospection`.
   *
   * Keyed by name, not uuid: a route change remounts the scene, every uuid changes, and an
   * override keyed by uuid would silently stop applying after the first navigation.
   */
  overrides: Record<string, string>;
  setRoot: (root: THREE.Object3D | null) => void;
  refresh: () => void;
  select: (uuid: string | null) => void;
  setOverride: (objectName: string, materialId: string) => void;
  setUniform: (uuid: string, name: string, value: number | string) => void;
  addImport: (url: string, name: string) => void;
  removeImport: (id: string) => void;
};

export const useInspectStore = create<InspectState>()((set, get) => ({
  rev: 0,
  objects: [],
  selectedUuid: null,
  imports: [],
  overrides: {},

  setRoot: (root) => {
    liveRoot = root;
    liveObjects.clear();
    get().refresh();
  },

  refresh: () => {
    if (liveRoot == null) return;
    const objects: InspectObject[] = [];
    liveObjects.clear();

    liveRoot.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!("isMesh" in node) || typeof mesh.material === "undefined") return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      liveObjects.set(node.uuid, mesh);
      objects.push({
        uuid: node.uuid,
        name:
          node.name === ""
            ? ((node.userData["theatreKey"] as string | undefined) ?? `${node.type} ${node.id}`)
            : node.name,
        type: node.type,
        materialType: material?.type ?? "none",
        materialId: materialIdOf(material),
        uniforms: material == null ? [] : readUniforms(material),
        keyed: typeof node.userData["theatreKey"] === "string",
      });
    });

    set((state) => ({ objects, rev: state.rev + 1 }));
  },

  select: (uuid) => {
    set((state) => ({ selectedUuid: uuid, rev: state.rev + 1 }));
  },

  setOverride: (objectName, materialId) => {
    set((state) => ({
      overrides: { ...state.overrides, [objectName]: materialId },
      rev: state.rev + 1,
    }));
  },

  setUniform: (uuid, name, value) => {
    const mesh = liveObjects.get(uuid);
    const material = mesh?.material;
    const shader = (Array.isArray(material) ? material[0] : material) as
      | THREE.ShaderMaterial
      | undefined;
    const entry = shader?.uniforms?.[name];
    if (entry != null) {
      if (typeof value === "number") {
        entry.value = value;
      } else if (
        typeof entry.value === "object" &&
        entry.value !== null &&
        "isColor" in entry.value
      ) {
        (entry.value as THREE.Color).set(value);
      }
    }

    /* The store's copy is for the panel; the material above is what the frame reads. */
    set((state) => ({
      objects: state.objects.map((object) =>
        object.uuid === uuid
          ? {
              ...object,
              uniforms: object.uniforms.map((uniform) =>
                uniform.name === name
                  ? { ...uniform, value: uniformDisplay(entry?.value ?? value) }
                  : uniform,
              ),
            }
          : object,
      ),
      rev: state.rev + 1,
    }));
  },

  addImport: (url, name) => {
    const id = `import-${String(Date.now())}`;
    set((state) => ({ imports: [...state.imports, { id, url, name }] }));
  },

  removeImport: (id) => {
    const entry = get().imports.find((item) => item.id === id);
    if (entry?.url.startsWith("blob:")) URL.revokeObjectURL(entry.url);
    set((state) => ({ imports: state.imports.filter((item) => item.id !== id) }));
  },
}));
