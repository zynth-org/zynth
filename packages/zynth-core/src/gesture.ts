/**
 * @zynth/core/gesture
 *
 * Public gesture runtime entry point.
 *
 * Provides gesture definition builders and all gesture event types.
 * Gesture definitions are attached to host primitives via the `gesture` prop
 * on motion-capable components — no separate package required.
 *
 * @example
 * ```tsx
 * import { createTapGesture, createPanGesture } from "@zynth/core/gesture";
 * import { createSharedValue } from "@zynth/core/motion";
 *
 * const pressed = createSharedValue(0);
 *
 * <Pressable
 *   gesture={createTapGesture({
 *     onStart: () => { "worklet"; pressed.value = 1; },
 *     onEnd:   () => { "worklet"; pressed.value = 0; },
 *   })}
 * />
 * ```
 */

// Gesture builders
export {
  createTapGesture,
  createLongPressGesture,
  createRotationGesture,
  createPinchGesture,
  createFlingGesture,
  createPanGesture,
} from "./gesture/gestures";

// Gesture types
export type {
  GesturePhase,
  GestureKind,
  FlingDirection,
  BaseGestureEvent,
  TapGestureEvent,
  LongPressGestureEvent,
  RotationGestureEvent,
  PinchGestureEvent,
  FlingGestureEvent,
  PanGestureEvent,
  GestureCallbacks,
  TapGestureConfig,
  LongPressGestureConfig,
  RotationGestureConfig,
  PinchGestureConfig,
  FlingGestureConfig,
  PanGestureConfig,
  TapGesture,
  LongPressGesture,
  RotationGesture,
  PinchGesture,
  FlingGesture,
  PanGesture,
  GestureDefinition,
  GestureInput,
  GestureDetectorProps,
} from "./gesture/types";
