import type { HostNode, StyleProp } from "@zynth/core";
import { setProperty } from "@zynth/core";
import {
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  runWithOwner,
  splitProps,
  onCleanup,
  type ParentComponent,
} from "solid-js";
import type {
  BaseGestureEvent,
  FlingGesture,
  FlingGestureEvent,
  GestureDefinition,
  GestureDetectorProps,
  GesturePhase,
  LongPressGesture,
  LongPressGestureEvent,
  PanGesture,
  PanGestureEvent,
  PinchGesture,
  PinchGestureEvent,
  RotationGesture,
  RotationGestureEvent,
  TapGesture,
  TapGestureEvent,
} from "@zynth/core/gesture";
import { useAnimatedStyleMapper } from "../hooks/useAnimatedStyleMapper";

export type { GestureDetectorProps } from "@zynth/core/gesture";

const noopRef = () => {};

function readNumber(
  value: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const raw = value[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readString(
  value: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const raw = value[key];
  if (typeof raw === "string") return raw;
  return fallback;
}

function normalizePhase(input: string): GesturePhase {
  if (input === "start") return "start";
  if (input === "update") return "update";
  if (input === "end") return "end";
  if (input === "deactivate") return "deactivate";
  return "update";
}

function normalizeBaseEvent(
  raw: unknown,
  fallbackKind: BaseGestureEvent["phase"] = "update",
): BaseGestureEvent {
  const value =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
    phase: normalizePhase(readString(value, "phase", fallbackKind)),
    timestamp: readNumber(value, "timestamp", Date.now()),
    x: readNumber(value, "x", 0),
    y: readNumber(value, "y", 0),
    absoluteX: readNumber(value, "absoluteX", readNumber(value, "x", 0)),
    absoluteY: readNumber(value, "absoluteY", readNumber(value, "y", 0)),
  };
}

function normalizeTapEvent(raw: unknown): TapGestureEvent {
  const base = normalizeBaseEvent(raw, "end");
  const value =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return { kind: "tap", ...base, numberOfTaps: readNumber(value, "numberOfTaps", 1) };
}

function normalizeLongPressEvent(raw: unknown): LongPressGestureEvent {
  const base = normalizeBaseEvent(raw, "update");
  const value =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return { kind: "longPress", ...base, durationMs: readNumber(value, "durationMs", 0) };
}

function normalizeRotationEvent(raw: unknown): RotationGestureEvent {
  const base = normalizeBaseEvent(raw, "update");
  const value =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
    kind: "rotation",
    ...base,
    rotation: readNumber(value, "rotation", 0),
    velocity: readNumber(value, "velocity", 0),
    anchorX: readNumber(value, "anchorX", base.x),
    anchorY: readNumber(value, "anchorY", base.y),
  };
}

function normalizePinchEvent(raw: unknown): PinchGestureEvent {
  const base = normalizeBaseEvent(raw, "update");
  const value =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
    kind: "pinch",
    ...base,
    scale: readNumber(value, "scale", 1),
    velocity: readNumber(value, "velocity", 0),
    focalX: readNumber(value, "focalX", base.x),
    focalY: readNumber(value, "focalY", base.y),
  };
}

function normalizeFlingEvent(raw: unknown): FlingGestureEvent {
  const base = normalizeBaseEvent(raw, "end");
  const value =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const direction = readString(value, "direction", "unknown");
  return {
    kind: "fling",
    ...base,
    velocityX: readNumber(value, "velocityX", 0),
    velocityY: readNumber(value, "velocityY", 0),
    direction:
      direction === "left" ||
      direction === "right" ||
      direction === "up" ||
      direction === "down"
        ? direction
        : "unknown",
  };
}

function normalizePanEvent(raw: unknown): PanGestureEvent {
  const base = normalizeBaseEvent(raw, "update");
  const value =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
    kind: "pan",
    ...base,
    translationX: readNumber(value, "translationX", 0),
    translationY: readNumber(value, "translationY", 0),
    velocityX: readNumber(value, "velocityX", 0),
    velocityY: readNumber(value, "velocityY", 0),
  };
}

function toGestureList(input: GestureDetectorProps["gesture"]): GestureDefinition[] {
  if (typeof input === "function") return toGestureList(input());
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

function invokePhaseCallback<TEvent extends BaseGestureEvent>(
  definition: {
    onStart?: (event: TEvent) => void;
    onUpdate?: (event: TEvent) => void;
    onEnd?: (event: TEvent) => void;
    onDeactivate?: (event: TEvent) => void;
  },
  event: TEvent,
  invoke: (callback: ((event: TEvent) => void) | undefined, payload: TEvent) => void,
): void {
  if (event.phase === "start") { invoke(definition.onStart, event); return; }
  if (event.phase === "update") { invoke(definition.onUpdate, event); return; }
  if (event.phase === "end") { invoke(definition.onEnd, event); return; }
  invoke(definition.onDeactivate, event);
}

/**
 * A native gesture recognizer container.
 *
 * Accepts one or more gesture definitions (via `createTapGesture`,
 * `createPanGesture`, etc. from `@zynth/core/gesture`) and wires their
 * callbacks to the native gesture recognizer on the UI thread.
 *
 * Supports `createAnimatedStyle` on the `style` prop — a native style mapper
 * is attached lazily when animated style metadata is detected.
 *
 * @example
 * ```tsx
 * import { GestureDetector } from "@zynth/components";
 * import { createPanGesture } from "@zynth/core/gesture";
 * import { createSharedValue } from "@zynth/core/motion";
 *
 * const tx = createSharedValue(0);
 * const pan = createPanGesture({ onUpdate: (e) => { tx.value = e.translationX; } });
 *
 * <GestureDetector gesture={pan}>
 *   <View style={createAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }))} />
 * </GestureDetector>
 * ```
 */
export const GestureDetector: ParentComponent<GestureDetectorProps> = (props) => {
  const [local] = splitProps(props, [
    "gesture",
    "style",
    "pointerEvents",
    "panSharedSignalX",
    "panSharedSignalY",
    "testID",
    "ref",
    "children",
  ]);

  const owner = getOwner();

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  // Reactive memo — avoids stale closure capture.
  const hasStyleAccessor = createMemo(() => typeof local.style === "function");

  const callWithOwner = <TEvent extends BaseGestureEvent>(
    callback: ((event: TEvent) => void) | undefined,
    event: TEvent,
  ): void => {
    if (!callback) return;
    if (owner) { runWithOwner(owner, () => callback(event)); return; }
    callback(event);
  };

  // ─── Animated style mapper ──────────────────────────────────────────────────
  // Detects `createAnimatedStyle` metadata and lazily attaches a native mapper.
  useAnimatedStyleMapper(() => local.style, hostNode);

  const gestures = createMemo(() => toGestureList(local.gesture));

  const tapGestures = createMemo(() =>
    gestures().filter((g) => g.kind === "tap") as TapGesture[],
  );
  const longPressGestures = createMemo(() =>
    gestures().filter((g) => g.kind === "longPress") as LongPressGesture[],
  );
  const rotationGestures = createMemo(() =>
    gestures().filter((g) => g.kind === "rotation") as RotationGesture[],
  );
  const pinchGestures = createMemo(() =>
    gestures().filter((g) => g.kind === "pinch") as PinchGesture[],
  );
  const flingGestures = createMemo(() =>
    gestures().filter((g) => g.kind === "fling") as FlingGesture[],
  );
  const panGestures = createMemo(() =>
    gestures().filter((g) => g.kind === "pan") as PanGesture[],
  );

  const resolvedStyle = createMemo(() => {
    const style = local.style;
    return (typeof style === "function" ? style() : style) ?? {};
  });

  const longPressMinDurationMs = createMemo(() => {
    const first = longPressGestures()[0];
    return first ? first.minDurationMs : undefined;
  });

  const flingMinVelocity = createMemo(() => {
    const first = flingGestures()[0];
    return first ? first.minVelocity : undefined;
  });

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    (local.ref ?? noopRef)(node);
  };

  onCleanup(() => {
    (local.ref ?? noopRef)(null);
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    if (!hasStyleAccessor()) return;
    setProperty(node, "style", resolvedStyle());
  });

  const handleTapGesture = (event: unknown) => {
    const normalized = normalizeTapEvent(event);
    for (const gesture of tapGestures()) invokePhaseCallback(gesture, normalized, callWithOwner);
  };
  const handleLongPressGesture = (event: unknown) => {
    const normalized = normalizeLongPressEvent(event);
    for (const gesture of longPressGestures()) invokePhaseCallback(gesture, normalized, callWithOwner);
  };
  const handleRotationGesture = (event: unknown) => {
    const normalized = normalizeRotationEvent(event);
    for (const gesture of rotationGestures()) invokePhaseCallback(gesture, normalized, callWithOwner);
  };
  const handlePinchGesture = (event: unknown) => {
    const normalized = normalizePinchEvent(event);
    for (const gesture of pinchGestures()) invokePhaseCallback(gesture, normalized, callWithOwner);
  };
  const handleFlingGesture = (event: unknown) => {
    const normalized = normalizeFlingEvent(event);
    for (const gesture of flingGestures()) invokePhaseCallback(gesture, normalized, callWithOwner);
  };
  const handlePanGesture = (event: unknown) => {
    const normalized = normalizePanEvent(event);
    for (const gesture of panGestures()) invokePhaseCallback(gesture, normalized, callWithOwner);
  };

  return (
    <zynth-gesture-detector
      ref={refProp}
      style={
        (hasStyleAccessor()
          ? undefined
          : (resolvedStyle() as unknown as StyleProp)) as unknown as StyleProp
      }
      pointerEvents={local.pointerEvents}
      panSharedSignalX={local.panSharedSignalX}
      panSharedSignalY={local.panSharedSignalY}
      testID={local.testID}
      longPressMinDurationMs={longPressMinDurationMs()}
      flingMinVelocity={flingMinVelocity()}
      onTapGesture={handleTapGesture}
      onLongPressGesture={handleLongPressGesture}
      onRotationGesture={handleRotationGesture}
      onPinchGesture={handlePinchGesture}
      onFlingGesture={handleFlingGesture}
      onPanGesture={handlePanGesture}
    >
      {local.children}
    </zynth-gesture-detector>
  );
};
