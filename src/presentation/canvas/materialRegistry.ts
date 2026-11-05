/**
 * The shader palette: the materials the studio can put on a mesh.
 *
 * `probe()` exists because the dropdown has to show what a mesh is *actually* wearing. The studio
 * cannot remember a mesh's material as state: Theatre and R3F build the graph, a scene remount
 * replaces every material, and a remembered id then points at an object that no longer exists. So
 * the entries compare against their own module-scope instances — the same trick the astro scenes
 * use for uniforms — and `probe()` returning the live instance is what makes `===` meaningful.
 *
 * An entry that creates a *new* material (`standard`, `basic`, …) has no single live instance to
 * compare; those report `custom` and the label falls back to the material's own `type`, which is
 * the truth anyway.
 */

import * as THREE from "three";

import { bodyMaterial, eyeMaterial, haloMaterial } from "@presentation/canvas/astroV2/materials.ts";

export type ShaderEntry = {
  id: string;
  label: string;
  /** `null` when the entry cannot be identified on a live mesh (it creates a fresh material). */
  probe: () => THREE.Material | null;
  create: () => THREE.Material;
};

const standard = () => new THREE.MeshStandardMaterial({ color: "#c9d4e0", roughness: 0.55 });
const normal = () => new THREE.MeshNormalMaterial();
const basic = () => new THREE.MeshBasicMaterial({ color: "#c9d4e0" });
const lambert = () => new THREE.MeshLambertMaterial({ color: "#c9d4e0" });
const physical = () => new THREE.MeshPhysicalMaterial({ color: "#c9d4e0", roughness: 0.3 });

export const SHADER_ENTRIES: ShaderEntry[] = [
  {
    id: "astro-body",
    label: "Astro body (unlit gradient + wave)",
    probe: () => bodyMaterial,
    create: () => bodyMaterial,
  },
  {
    id: "astro-eyes",
    label: "Astro eyes (sunken prism)",
    probe: () => eyeMaterial,
    create: () => eyeMaterial,
  },
  {
    id: "astro-halo",
    label: "Astro halo (additive shell)",
    probe: () => haloMaterial,
    create: () => haloMaterial,
  },
  { id: "standard", label: "Standard (lit)", probe: () => null, create: standard },
  { id: "physical", label: "Physical (lit, rough)", probe: () => null, create: physical },
  { id: "lambert", label: "Lambert (lit, cheap)", probe: () => null, create: lambert },
  { id: "normal", label: "Normal (debug)", probe: () => null, create: normal },
  { id: "basic", label: "Basic (unlit flat)", probe: () => null, create: basic },
];

export function materialFor(id: string): THREE.Material | null {
  return SHADER_ENTRIES.find((entry) => entry.id === id)?.create() ?? null;
}

export function defaultMaterialId(): string {
  return "standard";
}
