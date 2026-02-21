import type { HostNode, StyleProp } from "@zynth/core";
import type { JSX } from "solid-js";

export type GesturePhase = "start" | "update" | "end" | "deactivate";

export type GestureKind =
  | "tap"
  | "longPress"
  | "rotation"
  | "pinch"
  | "fling"
  | "pan";

export type FlingDirection = "left" | "right" | "up" | "down" | "unknown";

export interface BaseGestureEvent {
  phase: GesturePhase;
  timestamp: number;
  x: number;
  y: number;
  absoluteX: number;
  absoluteY: number;
}

export interface TapGestureEvent extends BaseGestureEvent {
  kind: "tap";
  numberOfTaps: number;
}

export interface LongPressGestureEvent extends BaseGestureEvent {
  kind: "longPress";
  durationMs: number;
}

export interface RotationGestureEvent extends BaseGestureEvent {
  kind: "rotation";
  rotation: number;
  velocity: number;
  anchorX: number;
  anchorY: number;
}

export interface PinchGestureEvent extends BaseGestureEvent {
  kind: "pinch";
  scale: number;
  velocity: number;
  focalX: number;
  focalY: number;
}

export interface FlingGestureEvent extends BaseGestureEvent {
  kind: "fling";
  velocityX: number;
  velocityY: number;
  direction: FlingDirection;
}

export interface PanGestureEvent extends BaseGestureEvent {
  kind: "pan";
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
}

export interface GestureCallbacks<TEvent extends BaseGestureEvent> {
  onStart?: (event: TEvent) => void;
  onUpdate?: (event: TEvent) => void;
  onEnd?: (event: TEvent) => void;
  onDeactivate?: (event: TEvent) => void;
}

export interface TapGestureConfig extends GestureCallbacks<TapGestureEvent> {
  numberOfTaps?: number;
  maxDelayMs?: number;
}

export interface LongPressGestureConfig
  extends GestureCallbacks<LongPressGestureEvent> {
  minDurationMs?: number;
}

export interface RotationGestureConfig
  extends GestureCallbacks<RotationGestureEvent> {
  minRotation?: number;
}

export interface PinchGestureConfig extends GestureCallbacks<PinchGestureEvent> {
  minScaleDelta?: number;
}

export interface FlingGestureConfig extends GestureCallbacks<FlingGestureEvent> {
  minVelocity?: number;
}

export interface PanGestureConfig extends GestureCallbacks<PanGestureEvent> {
  minDistance?: number;
}

interface GestureBase<TKind extends GestureKind> {
  id: number;
  kind: TKind;
}

export interface TapGesture extends GestureBase<"tap">, TapGestureConfig {
  numberOfTaps: number;
  maxDelayMs: number;
}

export interface LongPressGesture
  extends GestureBase<"longPress">,
    LongPressGestureConfig {
  minDurationMs: number;
}

export interface RotationGesture
  extends GestureBase<"rotation">,
    RotationGestureConfig {
  minRotation: number;
}

export interface PinchGesture
  extends GestureBase<"pinch">,
    PinchGestureConfig {
  minScaleDelta: number;
}

export interface FlingGesture
  extends GestureBase<"fling">,
    FlingGestureConfig {
  minVelocity: number;
}

export interface PanGesture extends GestureBase<"pan">, PanGestureConfig {
  minDistance: number;
}

export type GestureDefinition =
  | TapGesture
  | LongPressGesture
  | RotationGesture
  | PinchGesture
  | FlingGesture
  | PanGesture;

export type GestureInput =
  | GestureDefinition
  | GestureDefinition[]
  | null
  | undefined
  | (() => GestureDefinition | GestureDefinition[] | null | undefined);

export interface GestureDetectorProps {
  gesture: GestureInput;
  style?: StyleProp | (() => StyleProp | undefined);
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  /**
   * Optional native shared-signal id that receives pan X updates directly on UI thread.
   */
  panSharedSignalX?: number;
  /**
   * Optional native shared-signal id that receives pan Y updates directly on UI thread.
   */
  panSharedSignalY?: number;
  testID?: string;
  key?: string | number;
  ref?: (node: HostNode | null) => void;
  children?: JSX.Element;
}
