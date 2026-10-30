import { useEffect } from "react";
import { CanvasTexture, DoubleSide, LinearFilter, Mesh, SRGBColorSpace, Vector3 } from "three";
import { editable, SheetProvider } from "@theatre/r3f";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { Camera } from "three";

import { COLOUR_SPHERE_KEY, SURFACE_CAMERA, SURFACE_NODES } from "@core/models/scene.ts";
import { SPHERE_SURFACE_ROTATION_Y, SURFACE_SPECS } from "@core/models/surface.ts";
import type { SurfaceId } from "@core/models/surface.ts";
import {
  clampFootprintToViewport,
  footprintFromNdc,
  type SurfaceFootprint,
} from "@core/usecases/surfaceFootprint.ts";
import {
  findSurfaceRect,
  uvToSurfacePoint,
  wheelDeltaToPixels,
} from "@core/usecases/surfaceInteraction.ts";

import { getSheet, SHEET_IDS } from "@infra/theatre/project.ts";
import { clearSurfaceFootprint, setSurfaceFootprint } from "@infra/surface/surfaceFootprints.ts";
import { getSurfaceRects } from "@infra/surface/surfaceRects.ts";

import { TheatreCameraRig } from "@presentation/canvas/cameras/TheatreCameraRig.tsx";
import { SceneLights } from "@presentation/canvas/elements/SceneLights.tsx";
import { SpawnedShapes } from "@presentation/canvas/elements/SpawnedShapes.tsx";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";

/**
 * Textures, one per canvas, created on demand.
 *
 * A `WeakMap` keyed by the canvas, because texture identity has to survive every
 * render: a `CanvasTexture` built in a component body is a new GPU upload per
 * render, and this component re-renders on every raster. Keyed by the canvas, so a
 * page that remounts and hands over a new canvas gets a new texture, and the old
 * entry is collected with the canvas that produced it.
 */
const textures = new WeakMap<HTMLCanvasElement, CanvasTexture>();

function textureForCanvas(canvas: HTMLCanvasElement): CanvasTexture {
  const cached = textures.get(canvas);
  if (cached != null) return cached;

  const texture = new CanvasTexture(canvas);
  // The canvas holds sRGB bytes and the material is unlit, so the pixels must reach
  // the framebuffer unchanged. Leave `colorSpace` at the default and the page is
  // washed out; leave tone mapping on and the app's ACES curve darkens it.
  texture.colorSpace = SRGBColorSpace;
  // A page is a screen, not a photograph. Mipmapping a 512×512 texture onto a plane
  // that covers a third of the viewport shimmers along the text edges, and mip
  // generation is a second full copy of every upload.
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;

  textures.set(canvas, texture);
  return texture;
}

/**
 * The mesh a surface page is mapped onto, and the raycast that presses its buttons.
 *
 * The texture is app state the page publishes, not something this component owns:
 * `canvases[id]` is `null` until the page mounts. A mesh with `map: null` renders
 * black, and a black plane reads as a broken renderer, so the material is
 * conditional and the placeholder is a colour, not a hole.
 */
/**
 * Is this pointerdown a mesh press?
 *
 * The canvas is not a hit target (R3F's `eventSource` puts `pointer-events: none` on
 * it and listens on the page root instead), so every pointerdown in the page reaches
 * the mesh handlers too — including the one on a log row, a card, a bar button. With
 * a texture under the finger that is a press the user did not make: tapping "Reset
 * log" over the colour sphere would paint it. The meshes cross the whole page, so
 * the gate cannot be "gaps only" — the sphere page's own button sits over the log
 * panel, and a gap-only gate would break the headline interaction. It gates on
 * controls instead: a press is anything that is not inside a button, a link, a form
 * control, the bar, or the table. Tapping a paragraph that happens to sit over a
 * mesh presses that mesh, which is what a mesh in front of the page means.
 */
const PRESS_BLOCKING_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  ".surface__bar",
  ".surface__table",
].join(", ");

function isMeshPressTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(PRESS_BLOCKING_SELECTOR) == null &&
    // The parked pages are 10 000 px off screen and `pointer-events: none`; a press
    // that reports one of them as its target is not a press on this page.
    target.closest(".surface-hosts") == null
  );
}

/**
 * The DOM element the pointer actually landed on.
 *
 * Read it off `nativeEvent`, never off `event.target`: R3F replaces `target` on every
 * mesh event with a pointer-capture shim (`{ hasPointerCapture, setPointerCapture,
 * releasePointerCapture }`), and its type still says `EventTarget`, so
 * `event.target instanceof HTMLElement` is *always* false and compiles clean. A gate
 * written against `event.target` rejects every press through a texture, silently — the
 * textures render, the page's own buttons work, and the mesh is deaf.
 */
function pressDomTarget<T extends { target: EventTarget | null }>(
  event: ThreeEvent<T>,
): EventTarget | null {
  return event.nativeEvent.target;
}

/**
 * A gesture in progress on one surface.
 *
 * Module scope, not state: this is pointer-handler code that must not re-render, and
 * nothing renders from it. Keyed by surface, so a drag on the square and a drag on the
 * sphere cannot step on each other.
 */
type SurfaceGesture = {
  /** The pointer's last Y, so a drag scrolls by its own movement, not by its total. */
  lastY: number;
  /** How far the pointer has travelled since it went down. */
  travelled: number;
  /** The UV the pointer went down on — the press fires with this, not with the up's. */
  uv: { x: number; y: number } | null;
};

const gestures = new Map<SurfaceId, SurfaceGesture>();

/**
 * Travel below which a gesture is a tap.
 *
 * A press and a scroll start identically — a pointerdown on the mesh — and distance is
 * the only thing that tells them apart. Below this the gesture is a press; above it the
 * gesture scrolls and the painted button under the finger is *not* pressed, which is
 * what makes a scroll that starts on the sphere page's button a scroll and not a spin.
 */
const TAP_TRAVEL_LIMIT = 10;

function SurfacePageMesh({ surfaceId }: { surfaceId: SurfaceId }) {
  const spec = SURFACE_SPECS[surfaceId];
  const node = SURFACE_NODES.find((entry) => entry.theatreKey === spec.theatreKey);
  const canvas = useSurfaceStore((state) => state.canvases[surfaceId]);
  const version = useSurfaceStore((state) => state.versions[surfaceId]);

  const texture = canvas == null ? null : textureForCanvas(canvas);

  // The upload, once per raster. Not per frame: 512×512 RGBA is a megabyte, and a
  // frame subscription re-uploads pixels that did not change.
  useEffect(() => {
    if (texture == null) return;
    texture.needsUpdate = true;
  }, [texture, version]);

  /**
   * Press and scroll, from the same pointerdown.
   *
   * The raycast gives a UV, the page published rects in its own pixels, and the core
   * helper converts one into the other — including the vertical flip. Nothing here
   * knows the DOM and nothing in the DOM knows this: the store is the only wire, the
   * press is stamped with the playhead the page mirrors into that store, and the scroll
   * offset is app state the page translates its own content from. The mesh never
   * touches a sequence and never touches a DOM node.
   *
   * The press is committed on pointer **up**, gated on travel. Committing it on the
   * down is the shortcut, and it costs the gesture: a drag that starts on the painted
   * spin button would spin *and* scroll.
   */
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    // R3F raycasts the whole scene; without this the hit continues through to
    // everything behind the plane and the farthest object wins.
    event.stopPropagation();

    // A press on the page's own controls is the page's, not the texture's.
    if (!isMeshPressTarget(pressDomTarget(event))) {
      if (import.meta.env.DEV) {
        const target = pressDomTarget(event);
        console.info(
          `[surface:${surfaceId}] press rejected — DOM target`,
          target instanceof HTMLElement
            ? `${target.tagName.toLowerCase()}${target.className ? `.${target.className}` : ""}`
            : target,
        );
      }
      return;
    }

    // The wheel gate: the page's own wheel listener may only cancel the page's scroll
    // for a wheel this mesh consumed.
    useSurfaceStore.getState().setWheelTarget(surfaceId);

    // Nothing is done to the mesh here, on purpose. The UV arrives from the raycast
    // intersection, so the handler needs no matrix — and touching the mesh's transform
    // pipeline is how the spin dies: `matrixAutoUpdate = false` survives the press, so
    // the rig's keyframed `rotation.y` stops reaching the matrix, and the plane only
    // changes angle when the next press calls `updateMatrix()`.
    gestures.set(surfaceId, { lastY: event.clientY, travelled: 0, uv: event.uv ?? null });

    if (import.meta.env.DEV) {
      // The one readout that separates the two ways a texture press can die: the gate
      // rejected the tap (nothing logged here, a "press rejected" line instead), or the
      // tap arrived and the UV did not land in a rect (this line, with the point and the
      // rects it was aimed at).
      const point = event.uv
        ? uvToSurfacePoint(event.uv.x, event.uv.y, SURFACE_SPECS[surfaceId])
        : null;
      console.info(
        `[surface:${surfaceId}] press accepted — uv`,
        event.uv ? `${event.uv.x.toFixed(3)}, ${event.uv.y.toFixed(3)}` : "none",
        "→ page px",
        point ? `${Math.round(point.x)}, ${Math.round(point.y)}` : "outside",
        "rects",
        getSurfaceRects(surfaceId).map(
          (rect) => `${rect.action}@${Math.round(rect.y)}..${Math.round(rect.y + rect.height)}`,
        ),
      );
    }
  };

  /**
   * A drag on the mesh scrolls the page inside the texture.
   *
   * This is the touch half of the same command the wheel sends: finger up moves content
   * up, so the delta is `lastY - clientY`. The mesh is what the raycast hit, so the
   * gesture belongs to the texture page, and the page translates its own list — the
   * mesh does not rotate, does not move, and does not know what a scroll is.
   */
  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    const gesture = gestures.get(surfaceId);
    if (gesture == null) return;

    const delta = gesture.lastY - event.clientY;
    if (delta === 0) return;

    gesture.lastY = event.clientY;
    gesture.travelled += Math.abs(delta);
    if (gesture.travelled <= TAP_TRAVEL_LIMIT) return;

    useSurfaceStore.getState().scrollSurface(surfaceId, delta);
  };

  const commitPress = (gesture: SurfaceGesture) => {
    const uv = gesture.uv;
    if (uv == null) return;

    const point = uvToSurfacePoint(uv.x, uv.y, spec);
    if (point == null) return;

    const rect = findSurfaceRect(getSurfaceRects(surfaceId), point);
    if (rect == null) return;

    useSurfaceStore.getState().press({
      action: rect.action,
      source: "texture",
      point,
      from: useSurfaceStore.getState().playhead,
    });
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();

    const gesture = gestures.get(surfaceId);
    gestures.delete(surfaceId);
    if (gesture == null) return;

    // A gesture that travelled is a scroll. Its press was never a press.
    if (gesture.travelled > TAP_TRAVEL_LIMIT) return;

    commitPress(gesture);
  };

  /** A gesture that left the mesh commits nothing: the pointer is not pressing it. */
  const handlePointerOut = () => {
    gestures.delete(surfaceId);
    if (useSurfaceStore.getState().wheelTarget === surfaceId) {
      useSurfaceStore.getState().setWheelTarget(null);
    }
  };

  /**
   * The wheel over the mesh, sent to the page inside the texture.
   *
   * R3F registers `wheel` as a **passive** listener (`DOM_EVENTS.onWheel = ['wheel',
   * true]`, and `connect` passes `{ passive }` to `addEventListener`), so
   * `preventDefault` here does nothing. The page's own listener is the one that
   * cancels the page's scroll, and it does that on this signal.
   */
  const handleWheel = (event: ThreeEvent<WheelEvent>) => {
    event.stopPropagation();
    if (!isMeshPressTarget(pressDomTarget(event))) return;

    useSurfaceStore.getState().setWheelTarget(surfaceId);
    useSurfaceStore
      .getState()
      .scrollSurface(surfaceId, wheelDeltaToPixels(event.deltaY, event.deltaMode));
  };

  if (node == null) return null;

  return (
    <editable.mesh
      theatreKey={node.theatreKey}
      name={MESH_NAMES[surfaceId]}
      position={node.position}
      rotation={[0, surfaceId === "sphere" ? SPHERE_SURFACE_ROTATION_Y : 0, 0]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerOut}
      onPointerOut={handlePointerOut}
      onWheel={handleWheel}
    >
      {surfaceId === "sphere" ? (
        <sphereGeometry args={[0.95, 48, 32]} />
      ) : (
        <planeGeometry args={[2.2, 2.2]} />
      )}
      {texture == null ? (
        <meshBasicMaterial color="#10141d" side={DoubleSide} />
      ) : (
        // DoubleSide, not the default FrontSide: the spin turns the plane a full
        // revolution, and a single-sided plane vanishes for half of it. The back
        // shows the page mirrored, which is what a printed card does.
        <meshBasicMaterial map={texture} toneMapped={false} side={DoubleSide} />
      )}
    </editable.mesh>
  );
}

/**
 * The scene-graph name each surface mesh is findable by.
 *
 * A ref on `editable.mesh` is a ref through Theatre's wrapper, and the footprint is a
 * side channel the mesh knows nothing about. Looking the object up by name from the
 * render loop keeps the mesh component free of it.
 */
const MESH_NAMES: Record<SurfaceId, string> = {
  square: "surface-mesh-square",
  sphere: "surface-mesh-sphere",
};

const FOOTPRINT_AXES: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const scratchCenter = new Vector3();
const scratchPoint = new Vector3();

function footprintOfMesh(
  mesh: Mesh,
  camera: Camera,
  width: number,
  height: number,
): SurfaceFootprint | null {
  mesh.geometry.computeBoundingSphere();
  const radius = mesh.geometry.boundingSphere?.radius ?? 0;
  if (!(radius > 0)) return null;

  mesh.getWorldPosition(scratchCenter);

  // Six points around the bounding sphere, not the centre. The centre is the mesh's
  // position, and a footprint from it is a box around a point: the shield would cover
  // the middle of the sphere and leave its edges — where the page's button is painted —
  // outside the region that owns the touch.
  const points: { x: number; y: number }[] = [];
  for (const [axisX, axisY, axisZ] of FOOTPRINT_AXES) {
    scratchPoint
      .set(
        scratchCenter.x + axisX * radius,
        scratchCenter.y + axisY * radius,
        scratchCenter.z + axisZ * radius,
      )
      .project(camera);
    points.push({ x: scratchPoint.x, y: scratchPoint.y });
  }

  const box = footprintFromNdc(points, width, height);
  return box == null ? null : clampFootprintToViewport(box, width, height);
}

/**
 * Publishes each mesh's screen box, once per frame.
 *
 * The page under the canvas needs this to place a `touch-action: none` shield over the
 * mesh. Browsers read `touch-action` at touchstart, from the element the finger landed
 * on, so a class added in `pointerdown` is a frame too late: the page pans, the pointer
 * stream is cancelled, and the drag on the texture never happens. The shield has to be
 * under the finger before the gesture, which means the mesh's box has to be known
 * before the gesture — which means it is published from the render loop, because the
 * plane spins and the sphere bobs while a clip plays.
 *
 * It writes through `surfaceFootprints.ts`, not the store: a store field written every
 * frame re-renders its subscribers 60 times a second, which is the camera-target
 * pattern AGENTS.md calls out. The only consumer is one div's `style`.
 */
function SurfaceFootprintPublisher() {
  const { camera, scene, size } = useThree();

  useFrame(() => {
    for (const surfaceId of ["square", "sphere"] as const) {
      const mesh = scene.getObjectByName(MESH_NAMES[surfaceId]);
      if (!(mesh instanceof Mesh)) {
        clearSurfaceFootprint(surfaceId);
        continue;
      }

      setSurfaceFootprint(surfaceId, footprintOfMesh(mesh, camera, size.width, size.height));
    }
  });

  // A footprint left behind after the route unmounts is a shield that keeps swallowing
  // touches on a page with no mesh under it.
  useEffect(
    () => () => {
      clearSurfaceFootprint("square");
      clearSurfaceFootprint("sphere");
    },
    [],
  );

  return null;
}

/**
 * The sphere the square page paints.
 *
 * Its colour is app state. A rig colour and a store colour on the same prop means
 * the clip wins silently and the button appears to do nothing, so the rig has no
 * colour track on this object — only its transform is Theatre's.
 */
function ColourSphere({ color }: { color: string }) {
  const node = SURFACE_NODES.find((entry) => entry.theatreKey === COLOUR_SPHERE_KEY);
  if (node == null) return null;

  return (
    <editable.mesh theatreKey={node.theatreKey} position={node.position}>
      <sphereGeometry args={[0.62, 48, 32]} />
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
    </editable.mesh>
  );
}

/**
 * `/surface` — React pages, rasterized into meshes.
 *
 * The square page is a plane, the sphere page is the same page wrapped around a
 * sphere, and each carries one button that drives the **other** object: the square
 * paints the colour sphere, the sphere spins the square. That pairing is the point —
 * a press through a texture and the same press from the real DOM arrive at the same
 * store action, and the log says which one came through the mesh.
 *
 * Only one prop is keyframed in the rig: `Surface Plane.rotation.y`, the spin. The
 * plane's JSX rotation is its resting orientation, and the page never writes
 * rotation — a keyframed prop written from the page loses to the clip with no
 * warning, which is the rule every other scene follows.
 *
 * The page owns playback, same as `/float`: no `useSheetPlayback` call here. A scene
 * component that started the spin clip on its own would be a second owner of the
 * same playhead, and the page's seek would race a clip it did not start.
 *
 * The canvas is transparent and the page is *behind* it — the pages under the
 * textures are off-screen hosts, so nothing here needs to avoid drawing: the plane
 * and the spheres are the whole picture.
 */
export function SurfaceScene() {
  const sheet = getSheet(SHEET_IDS.surface);
  const sphereColor = useSurfaceStore((state) => state.sphereColor);

  return (
    <SheetProvider sheet={sheet}>
      <TheatreCameraRig
        theatreKey="Surface Camera"
        position={SURFACE_CAMERA.position}
        fov={SURFACE_CAMERA.fov}
      />

      <SceneLights
        theatreKey="MainLight"
        ambientIntensity={0.75}
        keyIntensity={1.2}
        keyPosition={[3, 5, 6]}
      />

      <SurfacePageMesh surfaceId="square" />
      <SurfacePageMesh surfaceId="sphere" />
      <ColourSphere color={sphereColor} />
      <SurfaceFootprintPublisher />

      <SpawnedShapes />
    </SheetProvider>
  );
}

export default SurfaceScene;
