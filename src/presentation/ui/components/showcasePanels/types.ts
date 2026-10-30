/**
 * The contract every showcase panel satisfies.
 *
 * One prop, and it is deliberately not the node id: a panel is opened *by* a
 * cube, and the page resolves the cube's `theatreKey` to a panel in
 * `registry.ts`. A panel that also received the key would be able to reach back
 * at the scene, and the store is the only 2D ↔ 3D channel in this project.
 *
 * A panel owns its own state and its own stylesheet. Nothing in
 * `ShowcasePage.tsx` knows what any of the four panels contain — the page knows
 * a key, a title and that the entry has a component.
 */
export type ShowcasePanelProps = {
  onClose(): void;
};
