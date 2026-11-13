# UI/UX Design System & Agent Guidelines

This document defines the visual language, color palette, typography, and component styling based on the reference UI specification. Use these guidelines when generating frontend code, UI components, or styling rules.

## 1. Color Palette

The theme uses a high-contrast dark mode aesthetic (`#000000` background) paired with vibrant warm oranges/reds and soft neutral accents.

### Primary & Accent Colors (Warm Spectrum)

- **Primary Amber / Orange:** `#FF8B00` (Vibrant orange, used for primary highlights and gradient starts)

- **Secondary Coral / Terracotta:** `#FA6B2F` (Mid-tone warm orange, used for transitions and secondary states)

- **Accent Red-Orange:** `#FE3402` (Intense neon red-orange, used for focal gradients, active states, and strong glows)

### Neutrals & Surfaces

- **Warm Sand / Beige:** `#EDCA99` (Soft warm neutral for secondary badges or muted accents)

- **Off-White / Cream:** `#FEFBF5` (Primary light text, light-mode icon containers, and high-contrast foregrounds)

- **Dark Slate / Deep Purple-Navy:** `#1A152C` (Elevated dark surface, secondary cards, and dark UI containers)

- **Pure Black (Background):** `#000000` (Main application background)

### Primary Brand Gradients

- **Brand Glow Gradient:** `linear-gradient(135deg, #FF8B00 0%, #FA6B2F 50%, #FE3402 100%)`

- **Card Header Gradient (Variant 1):** `linear-gradient(135deg, #FE3402 0%, #FA6B2F 50%, #FE3402 100%)`

- **Card Header Gradient (Variant 2):** `linear-gradient(135deg, #FE3402 0%, #FF8B00 60%, #FA6B2F 100%)`

## 2. Typography

- **Font Family:** `'Urbanist', sans-serif`

- **Available Weights:**

  - Thin (`100`)

  - ExtraLight (`200`)

  - Light (`300`)

  - Regular (`400`)

  - Medium (`500`)

  - SemiBold (`600`)

  - Bold (`700`)

  - ExtraBold (`800`)

  - Black (`900`)

### Type Scale & Hierarchy

| Element     | Font Family | Weight           | Size               | Line Height (Suggested) |
| ----------- | ----------- | ---------------- | ------------------ | ----------------------- |
| **H1**      | Urbanist    | Bold (`700`)     | `48px` (`3rem`)    | `1.15`                  |
| **H2**      | Urbanist    | SemiBold (`600`) | `40px` (`2.5rem`)  | `1.2`                   |
| **H3**      | Urbanist    | Medium (`500`)   | `36px` (`2.25rem`) | `1.25`                  |
| **Body**    | Urbanist    | Regular (`400`)  | `24px` (`1.5rem`)  | `1.5`                   |
| **Caption** | Urbanist    | Light (`300`)    | `20px` (`1.25rem`) | `1.4`                   |

## 3. Iconography & Apple "Liquid Glass" Style (MANDATORY)

**CRITICAL RULE FOR THE AGENT:** All icons, action buttons, and glassmorphic surfaces **MUST** strictly follow **Apple's Liquid Glass** design language (as seen in visionOS and modern iOS). They must never look like flat 2D vectors. Every icon and button must exhibit optical refraction, curved specular rim highlights, physical depth, and multi-layered translucency.

### A. Apple Liquid Glass Action Buttons (Dark Circular Controls)

Used for utility and navigation controls (bell, microphone, AI sparkles, chevrons, plus button).

- **Aesthetic:** Apple visionOS / iOS Liquid Glass material.

- **Shape:** Perfect circle (`border-radius: 9999px`).

- **Optical Refraction & Blur:** Heavy backdrop blur (`backdrop-filter: blur(20px) saturate(180%)`) with a translucent dark base (`#1A152C` blended with black).

- **Specular Rim Lighting (Key Apple Liquid Glass Trait):** A sharp, high-contrast diagonal specular highlight along the top-left and bottom-right edges (`inset` box-shadows and gradient borders) that simulates light bending around a curved glass lens.

- **Inner Lens Volume:** Subtle inner glow that gives the button a convex, liquid-droplet feel.

**CSS Implementation Reference:**

```css
.apple-liquid-glass-btn {
  background: radial-gradient(
    120% 120% at 25% 15%,
    rgba(254, 251, 245, 0.18) 0%,
    rgba(26, 21, 44, 0.55) 50%,
    rgba(0, 0, 0, 0.85) 100%
  );
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(254, 251, 245, 0.22);
  box-shadow:
    inset 0 1.5px 2px rgba(254, 251, 245, 0.45),
    /* Top-left Apple specular rim */ inset 0 -1.5px 3px rgba(254, 251, 245, 0.12),
    /* Bottom-right refractive bounce */ inset 0 -4px 8px rgba(0, 0, 0, 0.75),
    /* Inner lens depth */ 0 8px 24px rgba(0, 0, 0, 0.65); /* Ambient elevation shadow */
  color: rgba(254, 251, 245, 0.85);
  border-radius: 9999px;
  transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.apple-liquid-glass-btn:hover {
  border-color: rgba(254, 251, 245, 0.4);
  box-shadow:
    inset 0 2px 4px rgba(254, 251, 245, 0.65),
    inset 0 -2px 6px rgba(254, 52, 2, 0.3),
    0 12px 28px rgba(0, 0, 0, 0.85);
  color: #fefbf5;
  transform: translateY(-1px);
}
```

### B. Apple Liquid Glass 3D App Icons (Warm Squircle Tiles)

Used for feature/category icons (user, home, share, location, notification, mail, edit, lock, search, cart, shield, calendar, folder, camera, settings, trash, wallet, briefcase, gallery, chat).

- **Aesthetic:** Apple iOS Liquid Glass 3D layered icons.

- **Squircle Container:** Apple continuous-curve squircle (`border-radius: 24%`), colored in `#FEFBF5` with subtle inner glass beveling and soft elevation shadow (`0 10px 25px rgba(0, 0, 0, 0.06)`).

- **Multi-Layered Liquid Glass Glyphs:**
  - **Base Layer:** Translucent warm gradient (`#FF8B00` to `#FE3402`) acting as tinted refractive glass.
  - **Foreground Frosted Glass Layer:** Overlapping icon elements (e.g., envelope flaps, folder fronts, lock bodies, chat bubbles) use a frosted, semi-transparent layer (`rgba(250, 107, 47, 0.45)` with `backdrop-filter: blur(8px)`) so the back layer softly bleeds through.
  - **Specular Glass Highlights:** Every icon shape must feature a crisp white/cream top inner bevel (`inset 0 1.5px 2px rgba(254, 251, 245, 0.75)`) to create the wet, glossy Apple Liquid Glass surface.
  - **Colored Caustic Shadow:** Warm diffused drop shadow beneath the glyph (`0 6px 14px rgba(254, 52, 2, 0.28)`) simulating light passing through colored glass onto the `#FEFBF5` tile.

## 4. UI Components

### Project Cards (`Projeto #1`, `Projeto #2`)

- **Container:** Apple Liquid Glass dark card surface (`rgba(26, 21, 44, 0.65)` blended with `#000000`), `border-radius: 20px`, `1px solid rgba(254, 251, 245, 0.14)`, subtle top specular edge and soft outer glow.

- **Thumbnail Area:** Upper 65% of the card, `border-radius: 14px`, filled with vibrant diagonal gradients (`#FE3402` $\rightarrow$ `#FA6B2F` $\rightarrow$ `#FF8B00`) with a soft inner glass sheen.

- **Footer Area:** Dark translucent glass gradient (`linear-gradient(180deg, rgba(26, 21, 44, 0.4) 0%, rgba(10, 8, 18, 0.9) 100%)`), left-aligned label in `Urbanist Regular/Medium`, `#FEFBF5`.

### Pill Badges / Micro Buttons

- **Primary Pill:** Solid/gradient orange liquid glass (`#FF8B00` to `#FE3402`), capsule shape (`border-radius: 999px`), glossy top highlight.

- **Secondary Light Pill:** Soft translucent cream surface (`rgba(254, 251, 245, 0.75)`), dark text/icon (`#1A152C`).

- **Tertiary Dark Pill:** Dark liquid glass surface (`rgba(26, 21, 44, 0.8)`), `1px solid rgba(254, 251, 245, 0.18)`, muted light text (`#FEFBF5`).

### AI Agent Avatar / Orb States

The central visual mascot is a glowing radial sphere representing the agent's state:

- **Body:** Perfect circle with a smooth gradient from `#FF8B00` (top-left) through `#FA6B2F` to `#FE3402` (bottom-right).

- **Ambient Aura:** Large, diffused radial glow behind the orb (`box-shadow: 0 0 120px 45px rgba(250, 107, 47, 0.45)`).

- **Active / Awake State:** Two vertical oval eyes in `#FEFBF5`.

- **Idle / Sleeping State:** Two curved horizontal closed-eye arcs in `#FEFBF5` with floating `"Z z"` typography in the top-right quadrant.
