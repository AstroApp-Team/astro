import { useId } from "react";

export type LiquidGlassIconName =
  | "trash"
  | "lock-open"
  | "mic"
  | "mic-off"
  | "stop"
  | "stop-square"
  | "chat"
  | "folder"
  | "add"
  | "refresh"
  | "terminal"
  | "fullscreen"
  | "exit-fullscreen"
  | "settings"
  | "astro-ask"
  | "arrow-back"
  | "sun"
  | "moon";

export type LiquidGlassIconTone = "default" | "active" | "ember" | "cream";

type LiquidGlassIconProps = {
  name: LiquidGlassIconName;
  tone?: LiquidGlassIconTone;
  size?: number;
  className?: string;
};

/**
 * Symbols for Liquid Glass controls, drawn the way SF Symbols sit on iOS 26 glass:
 * one flat colour, an even semibold stroke, rounded caps — and no gradients, glows or
 * frosted fills of their own. The depth belongs to the glass around them (`voice.css`),
 * and the colour to the tone, set in CSS as `currentColor`:
 *
 *   default  near-white      active  Astro orange
 *   ember    warning red     cream   white on tinted glass
 *
 * The one exception is `astro-ask`: Astro himself keeps his orange, and only the question
 * mark over his head follows the tone, so the toggle still reads as on or off.
 */
export default function LiquidGlassIcon({
  name,
  tone = "default",
  size = 20,
  className = "",
}: LiquidGlassIconProps) {
  const uid = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`liquid-glass-icon liquid-glass-icon--${tone}${className ? ` ${className}` : ""}`}
    >
      {renderGlyph(name, uid)}
    </svg>
  );
}

function renderGlyph(name: LiquidGlassIconName, uid: string) {
  switch (name) {
    case "mic":
      return (
        <>
          <rect
            x="8.75"
            y="2.75"
            width="6.5"
            height="11"
            rx="3.25"
            fill="currentColor"
            stroke="none"
          />
          <path d="M5.75 11a6.25 6.25 0 0 0 12.5 0M12 17.25v3.5" />
        </>
      );

    case "mic-off":
      return (
        <>
          <path d="M15.25 10.5V6a3.25 3.25 0 0 0-6.2-1.4M8.75 9.5v1.25a3.25 3.25 0 0 0 5.2 2.6" />
          <path d="M5.75 11a6.25 6.25 0 0 0 10.4 4.65M18.25 11a6.2 6.2 0 0 1-.45 2.35M12 17.25v3.5" />
          <path d="M4 4l16 16" />
        </>
      );

    case "stop":
    case "stop-square":
      return (
        <rect x="6.5" y="6.5" width="11" height="11" rx="2.75" fill="currentColor" stroke="none" />
      );

    case "chat":
      return (
        <path d="M12 4c4.7 0 8.5 3.13 8.5 7s-3.8 7-8.5 7c-.9 0-1.77-.11-2.6-.33L5.5 19.5l.9-3.35C4.6 14.85 3.5 13.02 3.5 11c0-3.87 3.8-7 8.5-7Z" />
      );

    case "folder":
      return (
        <path d="M3.5 7.25A2.25 2.25 0 0 1 5.75 5h3.4c.6 0 1.17.28 1.53.76L11.5 6.9h6.75a2.25 2.25 0 0 1 2.25 2.25v8.6A2.25 2.25 0 0 1 18.25 20H5.75a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
      );

    case "trash":
      return (
        <path d="M4.5 6.75h15M9.5 6.75V5.25c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25v1.5M6.5 6.75l.8 11.6A2 2 0 0 0 9.3 20.25h5.4a2 2 0 0 0 2-1.9l.8-11.6M10.25 10.75v5.5M13.75 10.75v5.5" />
      );

    case "lock-open":
      return (
        <>
          <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.75-1.3" />
          <rect x="5.5" y="10.5" width="13" height="9.75" rx="2.5" />
        </>
      );

    case "add":
      return <path d="M12 5v14M5 12h14" strokeWidth="2.1" />;

    case "refresh":
      return (
        <>
          <path d="M19 12a7 7 0 1 1-2.05-4.95" />
          <path d="M19.25 4.25v4h-4" />
        </>
      );

    case "terminal":
      return (
        <>
          <rect x="3.25" y="4.5" width="17.5" height="15" rx="3" />
          <path d="M7.5 9.75 10.25 12 7.5 14.25M12.75 14.5h3.75" />
        </>
      );

    case "fullscreen":
      return <path d="M14.5 4.5h5v5M19.5 4.5l-5.75 5.75M9.5 19.5h-5v-5M4.5 19.5l5.75-5.75" />;

    case "exit-fullscreen":
      return <path d="M14 5v5h5M14 10l5.5-5.5M10 19v-5H5M10 14l-5.5 5.5" />;

    case "settings":
      return (
        <>
          <path d="M12.22 2.75h-.44a1.75 1.75 0 0 0-1.75 1.75v.16a1.75 1.75 0 0 1-.88 1.51l-.38.22a1.75 1.75 0 0 1-1.75 0l-.13-.07a1.75 1.75 0 0 0-2.39.64l-.22.38a1.75 1.75 0 0 0 .64 2.39l.13.09a1.75 1.75 0 0 1 .88 1.5v.45a1.75 1.75 0 0 1-.88 1.52l-.13.08a1.75 1.75 0 0 0-.64 2.39l.22.38a1.75 1.75 0 0 0 2.39.64l.13-.07a1.75 1.75 0 0 1 1.75 0l.38.22a1.75 1.75 0 0 1 .88 1.51v.16a1.75 1.75 0 0 0 1.75 1.75h.44a1.75 1.75 0 0 0 1.75-1.75v-.16a1.75 1.75 0 0 1 .88-1.51l.38-.22a1.75 1.75 0 0 1 1.75 0l.13.07a1.75 1.75 0 0 0 2.39-.64l.22-.39a1.75 1.75 0 0 0-.64-2.39l-.13-.07a1.75 1.75 0 0 1-.88-1.52v-.44a1.75 1.75 0 0 1 .88-1.52l.13-.08a1.75 1.75 0 0 0 .64-2.39l-.22-.38a1.75 1.75 0 0 0-2.39-.64l-.13.07a1.75 1.75 0 0 1-1.75 0l-.38-.22a1.75 1.75 0 0 1-.88-1.51V4.5a1.75 1.75 0 0 0-1.75-1.75Z" />
          <circle cx="12" cy="12" r="2.75" />
        </>
      );

    case "astro-ask":
      return (
        <>
          <defs>
            <radialGradient id={`astro-${uid}`} cx="0.36" cy="0.3" r="0.8">
              <stop offset="0%" stopColor="#FFB04A" />
              <stop offset="55%" stopColor="#FA6B2F" />
              <stop offset="100%" stopColor="#FE3402" />
            </radialGradient>
          </defs>
          <circle cx="12" cy="16" r="6.2" fill={`url(#astro-${uid})`} stroke="none" />
          <ellipse cx="9.9" cy="15.7" rx="0.95" ry="1.6" fill="#FEFBF5" stroke="none" />
          <ellipse cx="14.1" cy="15.7" rx="0.95" ry="1.6" fill="#FEFBF5" stroke="none" />
          <path d="M9.8 3.4a2.2 2.2 0 1 1 3.6 1.7c-.9.65-1.4 1-1.4 1.9" strokeWidth="1.8" />
          <circle cx="12" cy="8.4" r="0.95" fill="currentColor" stroke="none" />
        </>
      );

    case "sun":
      return (
        <>
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <path d="M12 2.75v1.9M12 19.35v1.9M21.25 12h-1.9M4.65 12h-1.9M18.54 5.46l-1.34 1.34M6.8 17.2l-1.34 1.34M18.54 18.54 17.2 17.2M6.8 6.8 5.46 5.46" />
        </>
      );

    case "moon":
      return (
        <path
          d="M20 14.6A8.25 8.25 0 0 1 9.4 4a8.25 8.25 0 1 0 10.6 10.6Z"
          fill="currentColor"
          stroke="none"
        />
      );

    case "arrow-back":
      return <path d="M15 5.5 8.5 12l6.5 6.5" strokeWidth="2.1" />;
  }
}
