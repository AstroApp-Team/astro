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
  | "exit-fullscreen";

export type LiquidGlassIconTone = "default" | "active" | "ember" | "cream";

type LiquidGlassIconProps = {
  name: LiquidGlassIconName;
  tone?: LiquidGlassIconTone;
  size?: number;
  className?: string;
};

type ToneSpec = {
  strokeStart: string;
  strokeEnd: string;
  glassFill: string;
  glassSecondary: string;
  accent: string;
  glowClass: string;
};

const TONES: Record<LiquidGlassIconTone, ToneSpec> = {
  default: {
    strokeStart: "#FFFFFF",
    strokeEnd: "rgba(254, 251, 245, 0.72)",
    glassFill: "rgba(254, 251, 245, 0.2)",
    glassSecondary: "rgba(254, 251, 245, 0.1)",
    accent: "rgba(254, 251, 245, 0.9)",
    glowClass: "liquid-glass-icon--default",
  },
  active: {
    strokeStart: "#FFFFFF",
    strokeEnd: "#FFD199",
    glassFill: "rgba(255, 139, 0, 0.28)",
    glassSecondary: "rgba(254, 251, 245, 0.14)",
    accent: "#FF9F2E",
    glowClass: "liquid-glass-icon--active",
  },
  ember: {
    strokeStart: "#FEFBF5",
    strokeEnd: "#FF9B82",
    glassFill: "rgba(254, 52, 2, 0.3)",
    glassSecondary: "rgba(254, 251, 245, 0.12)",
    accent: "#FF5E3A",
    glowClass: "liquid-glass-icon--ember",
  },
  cream: {
    strokeStart: "#FFFFFF",
    strokeEnd: "rgba(254, 251, 245, 0.85)",
    glassFill: "rgba(254, 251, 245, 0.28)",
    glassSecondary: "rgba(254, 251, 245, 0.16)",
    accent: "#FEFBF5",
    glowClass: "liquid-glass-icon--cream",
  },
};

/**
 * Modern iOS 26 / visionOS-inspired Liquid Glass iconography.
 *
 * Crisp SF-style geometric paths paired with translucent frosted glass fills,
 * subtle top-left specular refraction, and clean SVG mask cutouts where elements overlap.
 */
export default function LiquidGlassIcon({
  name,
  tone = "default",
  size = 20,
  className = "",
}: LiquidGlassIconProps) {
  const uid = useId().replace(/:/g, "");
  const strokeId = `lg-s-${uid}`;
  const maskId = `lg-m-${uid}`;
  const spec = TONES[tone];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`liquid-glass-icon ${spec.glowClass}${className ? ` ${className}` : ""}`}
    >
      <defs>
        <linearGradient id={strokeId} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={spec.strokeStart} />
          <stop offset="100%" stopColor={spec.strokeEnd} />
        </linearGradient>
      </defs>

      {renderGlyph(name, strokeId, maskId, spec)}
    </svg>
  );
}

function renderGlyph(name: LiquidGlassIconName, strokeId: string, maskId: string, spec: ToneSpec) {
  const stroke = `url(#${strokeId})`;

  switch (name) {
    case "mic":
      return (
        <>
          <rect
            x="9.25"
            y="3"
            width="5.5"
            height="10.25"
            rx="2.75"
            fill={spec.glassFill}
            stroke={stroke}
            strokeWidth="1.6"
          />
          <path
            d="M6.25 11.25a5.75 5.75 0 0 0 11.5 0"
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M12 17v3.5M9.25 20.5h5.5"
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      );

    case "mic-off":
      return (
        <>
          <defs>
            <mask id={maskId}>
              <rect width="24" height="24" fill="#fff" />
              <path
                d="M4.25 4.25 19.75 19.75"
                stroke="#000"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </mask>
          </defs>
          <g mask={`url(#${maskId})`} opacity="0.62">
            <rect
              x="9.25"
              y="3"
              width="5.5"
              height="10.25"
              rx="2.75"
              fill={spec.glassSecondary}
              stroke={stroke}
              strokeWidth="1.55"
            />
            <path
              d="M6.25 11.25a5.75 5.75 0 0 0 11.5 0M12 17v3.5M9.25 20.5h5.5"
              stroke={stroke}
              strokeWidth="1.55"
              strokeLinecap="round"
            />
          </g>
          <path
            d="M4.5 4.5 19.5 19.5"
            stroke={spec.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      );

    case "stop":
      return (
        <>
          <circle
            cx="12"
            cy="12"
            r="8.75"
            fill={spec.glassSecondary}
            stroke={stroke}
            strokeWidth="1.55"
          />
          <rect x="8.75" y="8.75" width="6.5" height="6.5" rx="1.6" fill={spec.strokeStart} />
        </>
      );

    case "stop-square":
      return (
        <rect
          x="6.25"
          y="6.25"
          width="11.5"
          height="11.5"
          rx="3"
          fill={spec.strokeStart}
          stroke={stroke}
          strokeWidth="1"
        />
      );

    case "chat":
      return (
        <>
          <defs>
            <mask id={maskId}>
              <rect width="24" height="24" fill="#fff" />
              <path
                d="M5.75 8.5h7.5A2.75 2.75 0 0 1 16 11.25v3.5a2.75 2.75 0 0 1-2.75 2.75H8.9l-2.65 2.15v-2.15h-.5A2.75 2.75 0 0 1 3 14.75v-3.5A2.75 2.75 0 0 1 5.75 8.5Z"
                fill="#000"
                stroke="#000"
                strokeWidth="2.4"
              />
            </mask>
          </defs>
          <g mask={`url(#${maskId})`} opacity="0.72">
            <path
              d="M10.25 4.25h8A2.75 2.75 0 0 1 21 7v3.75a2.75 2.75 0 0 1-2.75 2.75h-.6v2.1l-2.6-2.1h-4.8A2.75 2.75 0 0 1 7.5 10.75V7a2.75 2.75 0 0 1 2.75-2.75Z"
              fill={spec.glassSecondary}
              stroke={stroke}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </g>
          <path
            d="M5.75 8.5h7.5A2.75 2.75 0 0 1 16 11.25v3.5a2.75 2.75 0 0 1-2.75 2.75H8.9l-2.65 2.15v-2.15h-.5A2.75 2.75 0 0 1 3 14.75v-3.5A2.75 2.75 0 0 1 5.75 8.5Z"
            fill={spec.glassFill}
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </>
      );

    case "folder":
      return (
        <>
          <path
            d="M3.25 7.25A2.5 2.5 0 0 1 5.75 4.75h3.15c.68 0 1.32.33 1.72.88l.65.87h7a2.5 2.5 0 0 1 2.5 2.5v1.25H3.25v-3Z"
            fill={spec.glassSecondary}
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <rect
            x="3.25"
            y="8.75"
            width="17.5"
            height="10.5"
            rx="2.6"
            fill={spec.glassFill}
            stroke={stroke}
            strokeWidth="1.6"
          />
        </>
      );

    case "trash":
      return (
        <>
          <path
            d="M6.5 7.25h11l-.78 11.1a2 2 0 0 1-2 1.85H9.28a2 2 0 0 1-2-1.85L6.5 7.25Z"
            fill={spec.glassFill}
            stroke={stroke}
            strokeWidth="1.55"
            strokeLinejoin="round"
          />
          <path
            d="M4.5 7.25h15M9.5 7.25V5.2c0-.66.54-1.2 1.2-1.2h2.6c.66 0 1.2.54 1.2 1.2v2.05"
            stroke={stroke}
            strokeWidth="1.55"
            strokeLinecap="round"
          />
          <path
            d="M10.25 11v5.25M13.75 11v5.25"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.72"
          />
        </>
      );

    case "lock-open":
      return (
        <>
          <path
            d="M8.5 10.5V7.4a3.5 3.5 0 0 1 6.72-1.35"
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <rect
            x="5.5"
            y="10.5"
            width="13"
            height="9.5"
            rx="2.8"
            fill={spec.glassFill}
            stroke={stroke}
            strokeWidth="1.6"
          />
          <circle cx="12" cy="15.25" r="1.25" fill={spec.strokeStart} />
        </>
      );

    case "add":
      return (
        <>
          <circle cx="12" cy="12" r="9" fill={spec.glassSecondary} opacity="0.65" />
          <path d="M12 6.5v11M6.5 12h11" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
        </>
      );

    case "refresh":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" fill={spec.glassSecondary} opacity="0.45" />
          <path
            d="M18.35 9.25A6.75 6.75 0 1 0 18.6 14"
            stroke={stroke}
            strokeWidth="1.65"
            strokeLinecap="round"
          />
          <path
            d="M15.4 9.5h3.5V6"
            stroke={stroke}
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case "terminal":
      return (
        <>
          <rect
            x="3.5"
            y="4.5"
            width="17"
            height="15"
            rx="3.2"
            fill={spec.glassSecondary}
            stroke={stroke}
            strokeWidth="1.45"
          />
          <path
            d="M7.5 9.75 10.5 12 7.5 14.25M12 14.25h4"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case "fullscreen":
      return (
        <>
          <rect
            x="4.5"
            y="4.5"
            width="15"
            height="15"
            rx="3.5"
            fill={spec.glassSecondary}
            opacity="0.55"
          />
          <path
            d="M14.5 5H19v4.5M19 5l-5.25 5.25M9.5 19H5v-4.5M5 19l5.25-5.25"
            stroke={stroke}
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case "exit-fullscreen":
      return (
        <>
          <rect
            x="4.5"
            y="4.5"
            width="15"
            height="15"
            rx="3.5"
            fill={spec.glassSecondary}
            opacity="0.55"
          />
          <path
            d="M14.25 9.75H19M14.25 9.75V5M19 5l-4.75 4.75M9.75 14.25H5M9.75 14.25V19M5 19l4.75-4.75"
            stroke={stroke}
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
  }
}
