/**
 * The animation state machine's public surface.
 *
 * `infrastructure/` and `presentation/` import from here and nowhere deeper. The
 * internal shapes in `types.ts` stay internal on purpose: a caller that can reach
 * `LayerRuntime` can mutate it, and the frame owns it.
 */

export { SCHEMA_VERSION } from "@core/models/animationStateMachine.ts";
export type {
  ActiveStateInfo,
  AimKind,
  AllCondition,
  AnyCondition,
  Blend1dState,
  Blend2dState,
  BlendChild,
  BooleanCondition,
  BooleanInputDef,
  BoneTransform,
  ClipState,
  Condition,
  ConstraintDef,
  ConstraintKind,
  CopyKind,
  DirectEntry,
  DirectState,
  Easing,
  ExitState,
  FadeSpec,
  FollowKind,
  InputDef,
  InterruptionPolicy,
  LayerDef,
  LeafCondition,
  LimitKind,
  ListenerAction,
  ListenerDef,
  ListenerTarget,
  Machine,
  MachineDefinition,
  MachineEventName,
  MachineEvents,
  MachineOptions,
  MachineOutput,
  MarkerDef,
  MaskDef,
  Measure,
  MorphWeights,
  NotCondition,
  NumberCondition,
  NumberInputDef,
  PointerEventName,
  PointerHit,
  PointerKind,
  PointerRef,
  PointerState,
  PlayStyle,
  ProportionalKind,
  Quat,
  Ref,
  RigDescription,
  ScrubBinding,
  SpeedBinding,
  StateDef,
  TimelineDef,
  TimelineEventDef,
  TransitionDef,
  TriggerCondition,
  TriggerInputDef,
  Vec3,
} from "@core/models/animationStateMachine.ts";

export type {
  AssetResolver,
  BoneChannelAsset,
  ClipAsset,
  MorphChannelAsset,
  MorphCurveAsset,
} from "@core/interfaces/animationAssets.ts";
export { CHANNEL_STRIDE, staticResolver } from "@core/interfaces/animationAssets.ts";

export { createMachine, mulberry32 } from "@core/usecases/animationStateMachine/createMachine.ts";
export type { CreateMachineOptions } from "@core/usecases/animationStateMachine/createMachine.ts";
export {
  MachineDefinitionError,
  validateDefinition,
} from "@core/usecases/animationStateMachine/validateDefinition.ts";
export type {
  ValidationIssue,
  ValidationReport,
} from "@core/usecases/animationStateMachine/validateDefinition.ts";

export { blendFraction, easingFn } from "@core/usecases/animationStateMachine/easing.ts";
export { blendPoses, toMachineOutput } from "@core/usecases/animationStateMachine/blendPoses.ts";
export { buildConstraintPlan } from "@core/usecases/animationStateMachine/applyConstraints.ts";
export {
  resolveAllMasks,
  resolveMaskRef,
} from "@core/usecases/animationStateMachine/maskResolver.ts";
export { weights1d, weightsBarycentric } from "@core/usecases/animationStateMachine/sampleState.ts";
export {
  advanceCursor,
  normalizedTime,
} from "@core/usecases/animationStateMachine/timelineCursor.ts";
