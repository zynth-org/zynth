import type {
  FlingGesture,
  FlingGestureConfig,
  LongPressGesture,
  LongPressGestureConfig,
  PanGesture,
  PanGestureConfig,
  PinchGesture,
  PinchGestureConfig,
  RotationGesture,
  RotationGestureConfig,
  TapGesture,
  TapGestureConfig,
} from "./types";

let nextGestureId = 1;

function nextId(): number {
  const current = nextGestureId;
  nextGestureId += 1;
  return current;
}

export function createTapGesture(config: TapGestureConfig = {}): TapGesture {
  return {
    id: nextId(),
    kind: "tap",
    numberOfTaps: config.numberOfTaps ?? 1,
    maxDelayMs: config.maxDelayMs ?? 250,
    onStart: config.onStart,
    onUpdate: config.onUpdate,
    onEnd: config.onEnd,
    onDeactivate: config.onDeactivate,
  };
}

export function createLongPressGesture(
  config: LongPressGestureConfig = {}
): LongPressGesture {
  return {
    id: nextId(),
    kind: "longPress",
    minDurationMs: config.minDurationMs ?? 500,
    onStart: config.onStart,
    onUpdate: config.onUpdate,
    onEnd: config.onEnd,
    onDeactivate: config.onDeactivate,
  };
}

export function createRotationGesture(
  config: RotationGestureConfig = {}
): RotationGesture {
  return {
    id: nextId(),
    kind: "rotation",
    minRotation: config.minRotation ?? 0,
    onStart: config.onStart,
    onUpdate: config.onUpdate,
    onEnd: config.onEnd,
    onDeactivate: config.onDeactivate,
  };
}

export function createPinchGesture(
  config: PinchGestureConfig = {}
): PinchGesture {
  return {
    id: nextId(),
    kind: "pinch",
    minScaleDelta: config.minScaleDelta ?? 0,
    onStart: config.onStart,
    onUpdate: config.onUpdate,
    onEnd: config.onEnd,
    onDeactivate: config.onDeactivate,
  };
}

export function createFlingGesture(
  config: FlingGestureConfig = {}
): FlingGesture {
  return {
    id: nextId(),
    kind: "fling",
    minVelocity: config.minVelocity ?? 800,
    onStart: config.onStart,
    onUpdate: config.onUpdate,
    onEnd: config.onEnd,
    onDeactivate: config.onDeactivate,
  };
}

export function createPanGesture(config: PanGestureConfig = {}): PanGesture {
  return {
    id: nextId(),
    kind: "pan",
    minDistance: config.minDistance ?? 2,
    onStart: config.onStart,
    onUpdate: config.onUpdate,
    onEnd: config.onEnd,
    onDeactivate: config.onDeactivate,
  };
}
