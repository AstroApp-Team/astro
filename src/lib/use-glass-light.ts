import { useEffect } from "react";

/**
 * Drives the light on every Liquid Glass control, the way iOS 26 glass catches the light
 * as the phone moves. Writes CSS custom properties that `voice.css` reads:
 *
 *   --lg-angle        where the bright edge of the specular rim sits (tilt / mouse)
 *   --lg-px, --lg-py  on the pressed control only: where the finger is, for the press highlight
 *
 * Tilt comes from `deviceorientation` (no prompt on Android; iOS would want a permission
 * request, so there the light simply stays put). On a desktop the mouse stands in for tilt.
 * Updates are batched to one per frame, and reduced motion keeps the light still.
 */

const GLASS = ".apple-liquid-glass-btn, .apple-liquid-glass-pill, .apple-liquid-glass-square";

const clamp = (n: number) => Math.max(-1, Math.min(1, n));

export function useGlassLight(): void {
  useEffect(() => {
    const root = document.documentElement;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    let tx = 0;
    let ty = 0;

    const apply = () => {
      frame = 0;
      root.style.setProperty("--lg-angle", `${(135 + tx * 45 + ty * 20).toFixed(1)}deg`);
    };
    const queue = (x: number, y: number) => {
      tx = clamp(x);
      ty = clamp(y);
      if (frame === 0) frame = requestAnimationFrame(apply);
    };

    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null) return;
      // Held upright-ish in the hand: beta ~45°. Left/right tilt is gamma.
      queue(event.gamma / 40, (event.beta - 45) / 40);
    };
    const onMouse = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      queue(
        (event.clientX / window.innerWidth) * 2 - 1,
        (event.clientY / window.innerHeight) * 2 - 1,
      );
    };
    /** Where the finger is on a pressed control, for its highlight. */
    const onPress = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest(GLASS) : null;
      if (!(target instanceof HTMLElement)) return;
      const box = target.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      target.style.setProperty("--lg-px", `${((event.clientX - box.left) / box.width) * 100}%`);
      target.style.setProperty("--lg-py", `${((event.clientY - box.top) / box.height) * 100}%`);
    };

    document.addEventListener("pointerdown", onPress, { passive: true, capture: true });
    if (!still) {
      window.addEventListener("deviceorientation", onTilt, { passive: true });
      window.addEventListener("pointermove", onMouse, { passive: true });
    }
    return () => {
      document.removeEventListener("pointerdown", onPress, { capture: true });
      window.removeEventListener("deviceorientation", onTilt);
      window.removeEventListener("pointermove", onMouse);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
}
