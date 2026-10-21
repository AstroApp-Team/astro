import { editable } from "@theatre/r3f";

/**
 * Ambient fill plus one key light, as editable Theatre.js objects.
 *
 * Lights are the property a rigged scene most often needs animated — a shot that
 * ends with the key light swinging behind an object is a two-minute job in the
 * Studio once the light is in the outliner, and a `useFrame` loop written by
 * hand if it is not.
 */
export type SceneLightsProps = {
  theatreKey?: string;
  ambientIntensity?: number;
  keyIntensity?: number;
  keyPosition?: [number, number, number];
};

export function SceneLights({
  theatreKey = "MainLight",
  ambientIntensity = 0.55,
  keyIntensity = 1.1,
  keyPosition = [6, 9, 5],
}: SceneLightsProps) {
  return (
    <>
      <editable.ambientLight theatreKey="AmbientLight" intensity={ambientIntensity} />
      <editable.directionalLight
        theatreKey={theatreKey}
        position={keyPosition}
        intensity={keyIntensity}
      />
    </>
  );
}
