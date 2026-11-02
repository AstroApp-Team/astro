### Objective

Design the UI/UX specification and component hierarchy for a Rive-inspired **3D Animation & Mesh State Machine Editor**. The interface must unify visual node-graph authoring, 3D skeletal/morph timeline scrubbing, interactive 1D/2D blend-space editors, and live real-time state debugging into a cohesive workspace.

Focus strictly on what each UI panel displays, what controls it exposes, and how user interactions flow between the 3D Viewport, the State Machine Graph, the Timeline Selector, and the Inspector.

---

### 1. Overall Workspace Layout

The editor is divided into four synchronized zones:

1. **Top Center — 3D Interactive Viewport:** Renders the 3D character/mesh in real time, reflecting whichever timeline or state machine is currently active.
2. **Bottom-Left Sidebar — Asset, Input & Layer Manager:** Houses the Timeline/State Machine switcher, State Machine Inputs (Parameters), and 3D Mesh Listeners.
3. **Bottom-Center Stage — Primary Editor Canvas:** Dynamically switches (or splits) between the **Visual State Machine Node Graph** and the **Timeline Keyframe Editor**.
4. **Right Sidebar — Context-Sensitive Inspector:** Dynamically updates its controls based on the currently selected node, transition noodle, blend state, layer, or timeline track.

---

### 2. Bottom-Left Sidebar: Selectors, Inputs & Listeners

#### A. Animations & State Machines Selector List

- **Purpose:** Acts as the master switcher between authoring raw animations and wiring logic in the state machine.
- **UI Controls & Behavior:**
  - Divided into two collapsible sections: **Timelines (Clips)** and **State Machines**.
  - **Selecting a Timeline:** Switches the Bottom-Center Stage into the **Timeline Editor** and loads that clip into the 3D Viewport for scrubbing or editing. Includes a quick inline `Play/Pause` icon next to each clip name for instant previewing.
  - **Selecting a State Machine:** Switches the Bottom-Center Stage into the **Visual State Machine Node Graph** and puts the 3D Viewport under the control of the state machine evaluator.

#### B. Inputs (Parameters) Panel

- **Purpose:** Defines the external black-box contract (`Number`, `Boolean`, `Trigger`) and serves as a **live control deck** when testing the state machine.
- **UI Controls & Behavior:**
  - `+` button to create a new typed input (`Number`, `Boolean`, or `Trigger`), with inline rename and drag-to-reorder.
  - **Live Interactive Mode (when State Machine is playing):**
    - **Number Inputs:** Render a draggable numeric scrubber and optional min/max slider. Dragging it immediately updates transition conditions and scrubs 1D/2D Blend Spaces in real time.
    - **Boolean Inputs:** Render an interactive toggle switch/checkbox (`true` / `false`).
    - **Trigger Inputs:** Render a momentary push button (pulse icon) that flashes when clicked to fire one-shot transitions.

#### C. 3D Listeners Panel

- **Purpose:** Maps direct user interaction in the 3D Viewport (clicking/hovering a sub-mesh or bone collider) to State Machine Inputs.
- **UI Controls & Behavior:**
  - List of listeners showing: `Target 3D Mesh/Collider` -> `Pointer Event (Click, Hover, PointerMove)` -> `Action (Set Number/Boolean or Fire Trigger)`.

---

### 3. Bottom-Center Stage (Mode A): Visual State Machine Node Graph

#### A. Layer Tab Bar & Mask Indicators

- **Purpose:** Manages parallel execution layers (e.g., `Base Locomotion`, `Upper Body Combat`, `Facial Morphs`).
- **UI Controls & Behavior:**
  - Horizontal tabs along the top of the graph canvas (or a compact vertical sub-list) representing each layer in evaluation order.
  - Each layer tab displays a badge for its **Blend Mode** (`OVR` for Override, `ADD` for Additive), a **Mask Icon** indicating if a 3D Bone/Mesh filter is active, and a solo/mute toggle for debugging.

#### B. Interactive Node Canvas

- **Purpose:** An infinite pan-and-zoom canvas for wiring animation states and transitions.
- **Node Visual Anatomy:**
  - **System Nodes (`Entry`, `Any State`, `Exit`):** Distinct pill-shaped nodes with color-coded headers (`Entry` = green, `Any State` = teal/purple, `Exit` = red). `Entry` and `Any State` only have output ports; `Exit` only has an input port.
  - **Single Clip State Node:** Rectangular card showing the state name, assigned Timeline Clip name, loop icon, and a live horizontal progress bar along the bottom edge. Double-clicking this node opens its assigned Timeline in the Timeline Editor.
  - **1D Blend State Node:** Card featuring a horizontal gradient/tick-mark icon, showing the bound `Number` input badge and a list of child clips/morphs with live weight bars (`0% - 100%`).
  - **2D Blend Space Node:** Card featuring a mini 2D coordinate grid preview showing the active `(X, Y)` sample dot moving across child clip nodes in real time.
  - **Direct Morph / Pose Blend Node:** Card displaying a multi-slider icon, listing direct `Input -> Mesh Morph Target` bindings with live weight meters.

#### C. Transition Noodles (Directed Edges)

- **Purpose:** Visualizes directional state changes, crossfade timing, and condition evaluation.
- **UI Controls & Behavior:**
  - Dragging from a node's output port to another node's input port creates a directional arrow (noodle).
  - If multiple transitions exist between the same two states, display a numbered badge on the line or fan out parallel noodles so each can be clicked independently.
  - Clicking a noodle highlights it and opens the **Transition Inspector** on the right.

#### D. Live State Machine Telemetry (Rive-Style Visual Debugging)

- **Purpose:** Makes runtime state evaluation completely transparent while the Play button is active.
- **Visual Feedback:**
  - **Active State Glow:** The currently active state node on each layer displays a glowing border and a live progress bar filling from `0%` to `100%` as the 3D clip plays.
  - **Animated Transition Flow:** When a transition triggers, a bright animated progress fill travels along the transition noodle from the source state to the destination state over the exact duration of the 3D crossfade. During this crossfade, both the outgoing and incoming state nodes show their live blending weight percentages.

---

### 4. Bottom-Center Stage (Mode B): Timeline Selector & Keyframe Editor

#### A. Switching & Split-View Workflow

- **Purpose:** Allows seamless movement between high-level state logic and low-level keyframe adjustments.
- **UI Controls & Behavior:**
  - Clicking any clip in the **Animations Selector List** (or double-clicking a Clip State node in the graph) swaps the center canvas to the **Timeline Editor**, or opens it in a **Split-View Dock** alongside the State Machine Graph.
  - Breadcrumb bar at the top of the Timeline (`State Machine > Layer > State Name > Clip Name`) lets the user return to the Node Graph in one click.

#### B. Timeline Transport & Track Hierarchy

- **Transport Header:** Play/Pause button, Frame/Seconds toggle, current timecode readout, Playback Speed multiplier (`0.25x`, `1x`, `2x`), Loop Mode selector (`One-Shot`, `Loop`, `Ping-Pong`), and draggable Work Area start/end trim brackets.
- **Track List (Left Column of Timeline):**
  - **Skeletal Tracks:** Collapsible hierarchy of 3D bones (`Position X/Y/Z`, `Rotation X/Y/Z`, `Scale`).
  - **Mesh Blend Shape (Morph Target) Tracks:** Dedicated tracks for each 3D mesh and its morph targets (e.g., `HeadMesh > BrowFurrow`, `Smile_L`, `DamageDent`), keyframed from `0.0` to `1.0`.
  - **Event Marker Track:** Top-level track where users drop named event pins (e.g., `footstep`, `play_sound`) that fire callbacks when crossed.
- **Dope Sheet & Curve Editor (Right Area of Timeline):** Toggle button to switch between dragging diamond keyframes on a grid and editing Bezier interpolation tangents.

---

### 5. Right Sidebar: Context-Sensitive Inspector

The Inspector changes its layout depending on the user's current selection:

#### A. When a "Single Clip State" is Selected

- **Timeline Clip Selector:** Dropdown to assign any 3D animation/morph clip from the project.
- **Speed & Scrubbing Controls:**
  - Static speed multiplier input (`1.0x`), OR a binding dropdown to drive playback speed dynamically via a `Number` input.
  - **Normalized Time Binding (Scrub Mode):** Optional toggle to bind the clip's playhead position (`0% - 100%`) directly to a `Number` input (e.g., driving a door-opening or aim-pitch animation via a float parameter).

#### B. When a "1D Blend State" is Selected

- **Driver Input Dropdown:** Selects which `Number` input controls the blend axis (e.g., `moveSpeed`).
- **Interactive 1D Threshold Bar:** A visual horizontal track with draggable diamond markers representing each child clip/morph state along the numeric range (e.g., `Idle` at `0.0`, `Walk` at `2.0`, `Run` at `6.0`).
- **Live Playhead Indicator:** A vertical scrubbing line on the 1D bar that moves in real time with the `Number` input, displaying a triangle influence curve under each marker.
- **Child Clip Table:** List below the bar where users add/remove clips, type exact threshold numbers, adjust individual clip speed multipliers, and view live calculated weight percentages.

#### C. When a "2D Blend Space" is Selected

- **X & Y Driver Dropdowns:** Selects two `Number` inputs (e.g., `velocityX` and `velocityZ`, or `faceValence` and `faceArousal`).
- **Blend Type Selector:** `2D Directional`, `2D Freeform Cartesian`, or `Bilinear Grid`.
- **Interactive 2D Blend Pad:**
  - A square 2D coordinate canvas where each child animation/morph clip is plotted as a draggable node at `(X, Y)` coordinates.
  - Renders visual interpolation triangles/influence rings around the nodes.
  - Features a **draggable Red Preview Dot (Live Cursor)**: dragging the dot inside the 2D pad immediately updates the 2D inputs, highlights the surrounding nodes with proportional rings, and previews the blended 3D skeletal pose and mesh morph weights in the 3D Viewport.
- **Child Node List:** Table of all plotted clips/morph states with exact `X`, `Y` numeric fields and a live weight meter (`0% - 100%`).

#### D. When a "Direct Morph / Pose Blend Node" is Selected

- **Purpose:** Allows direct 1-to-1 or 1-to-many parameter control over mesh blend shapes and additive poses without state transitions.
- **Mapping Table UI:**
  - Each row contains: `[Source Number Input Dropdown]` -> `[Input Range Remap: Min..Max]` -> `[Target Type: Mesh Morph Target OR Additive Clip]` -> `[Target Dropdown (e.g., Mesh.Blink_L)]` -> `[Live Weight Bar]`.

#### E. When a "Transition Noodle" is Selected

- **Transition Timing & Curve:**
  - **Duration:** Numeric input (`ms` or `s`) for the 3D skeletal/morph crossfade time.
  - **Easing Curve Picker:** Visual curve preset selector (`Linear`, `Ease In/Out`, `Cubic Bezier` with draggable handles).
  - **Exit Time:** Checkbox toggle + normalized slider (`0.00` to `1.00`) specifying how much of the source state must finish playing before this transition is allowed to fire.
  - **Interruption Behavior Dropdown:** `None (Lock until complete)`, `Current State`, `Next State`, or `Any State`.
- **Condition Builder UI:**
  - `+ Add Condition` button that builds logical evaluation rows.
  - Each row renders: `[Input Selector Dropdown]` + `[Comparison Operator: ==, !=, >, <, >=, <=]` + `[Threshold Value / Trigger Badge]`.
  - Supports grouping conditions with an `ALL (AND)` / `ANY (OR)` toggle.

#### F. When a "State Machine Layer" is Selected

- **Blend Mode Selector:** Segmented toggle between `Override` and `Additive` (with an optional reference-pose clip picker for additive calculation).
- **Layer Weight Slider:** `0.0` to `1.0` master opacity for the layer.
- **3D Bone & Mesh Mask Editor:**
  - **Visual Skeleton Silhouette / Bone Tree:** Interactive humanoid silhouette (head, torso, left arm, right arm, legs, fingers) plus a searchable hierarchical bone checklist to toggle which joints this layer affects.
  - **Mesh & Morph Target Group Filter:** Checklist of 3D meshes and morph target categories (e.g., `Allow Facial Morphs`, `Block Body Corrective Morphs`) so facial and body layers never conflict.

---

### Expected Deliverable

Produce a comprehensive UI/UX specification document detailing:

1. **Component Tree & Panel Architecture:** How the views, panels, and selection states are structured.
2. **User Interaction Flows:** Step-by-step UI behavior for: (a) creating an input and wiring a conditional transition, (b) building and live-scrubbing a 2D Blend Space, (c) switching between a State Node and its underlying 3D Timeline to tweak a morph target curve, and (d) live-testing the state machine in the viewport.
3. **State Synchronization Contract:** How UI actions in the Inspector, Node Graph, and Inputs Panel synchronize with the real-time 3D Viewport and runtime evaluator.
