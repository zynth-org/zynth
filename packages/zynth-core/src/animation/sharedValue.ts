import { createMemo, untrack, type Accessor } from "solid-js";
import {
  captureSharedSignals,
  createSharedSignal,
  readSharedSignal,
  type SharedSignalAccessor,
  type SharedSignalToken,
} from "../sharedSignal";
import type { Style } from "../host/HostTypes";
import { Easing, type EasingFunction } from "./easing";
import {
  DERIVED_VALUE_MARKER,
  INTERPOLATION_MARKER,
  SHARED_VALUE_MARKER,
  animateNativeSharedValue,
  consumeNativeAnimationCompletions,
  cancelNativeSharedValue,
  getNativeSharedValue,
  hasNativeAnimate,
  isNativePlatform,
  type NativeStyleMapperConfig,
} from "./native";
import { now, startAnimation } from "./runtime";

export type AnimationCallback = (finished: boolean) => void;

export type TimingConfig = {
  duration?: number;
  easing?: EasingFunction;
  delay?: number;
  onFinish?: AnimationCallback;
};

export type SpringConfig = {
  damping?: number;
  stiffness?: number;
  mass?: number;
  velocity?: number;
  restSpeedThreshold?: number;
  restDisplacementThreshold?: number;
  overshootClamping?: boolean;
  delay?: number;
  onFinish?: AnimationCallback;
};

type TimingAnimation = number & {
  __kind: "timing";
  toValue: number;
  config?: TimingConfig;
};

type SpringAnimation = number & {
  __kind: "spring";
  toValue: number;
  config?: SpringConfig;
};

type AnimationRequest = TimingAnimation | SpringAnimation;

/**
 * A reactive shared value that is synchronized with the native UI thread.
 * Setting `.value` to a `withTiming()` or `withSpring()` result will drive
 * the native animation engine directly when a native driver is available.
 */
export type SharedValue<T> = {
  get value(): T;
  set value(next: T);
  cancelAnimation: () => void;
  toSignal: () => SharedSignalAccessor<T>;
  nativeId?: number;
};

type SharedValueToken = SharedSignalToken;
type InterpolatedValueToken = {
  [INTERPOLATION_MARKER]: {
    source: { [SHARED_VALUE_MARKER]: number } | number;
    inputRange: number[];
    outputRange: number[];
    extrapolateLeft?: "identity" | "clamp" | "extend";
    extrapolateRight?: "identity" | "clamp" | "extend";
  };
  __zynth_shared_signal_current?: number;
};

type DerivedValueToken = {
  [DERIVED_VALUE_MARKER]: {
    source: SharedValueToken | InterpolatedValueToken | number;
    multiplier?: number;
    offset?: number;
  };
  __zynth_shared_signal_current?: number;
  valueOf: () => number;
  toString: () => string;
};

export interface DerivedValueConfig {
  multiplier?: number;
  offset?: number;
}

const DEFAULT_DURATION = 300;
const DEFAULT_DAMPING = 20;
const DEFAULT_STIFFNESS = 150;
const DEFAULT_MASS = 1;
const DEFAULT_REST_SPEED = 0.001;
const DEFAULT_REST_DISPLACEMENT = 0.001;
let nextNativeCompletionCallbackId = 1;
const nativeCompletionCallbacks = new Map<number, AnimationCallback>();
let nativeCompletionCancel: (() => void) | null = null;

function ensureNativeCompletionPolling(): void {
  if (nativeCompletionCancel || nativeCompletionCallbacks.size === 0) return;
  nativeCompletionCancel = startAnimation(() => {
    const completed = consumeNativeAnimationCompletions();
    for (const entry of completed) {
      const callback = nativeCompletionCallbacks.get(entry.callbackId);
      if (!callback) continue;
      nativeCompletionCallbacks.delete(entry.callbackId);
      try {
        callback(entry.finished);
      } catch (error) {
        console.error("[ZynthCore/Motion] shared value onFinish callback failed:", error);
      }
    }
    if (nativeCompletionCallbacks.size === 0) {
      nativeCompletionCancel = null;
      return true;
    }
    return false;
  });
}

function registerNativeCompletionCallback(callback: AnimationCallback): number {
  const callbackId = nextNativeCompletionCallbackId++;
  nativeCompletionCallbacks.set(callbackId, callback);
  ensureNativeCompletionPolling();
  return callbackId;
}

function unregisterNativeCompletionCallback(callbackId: number): void {
  nativeCompletionCallbacks.delete(callbackId);
  if (nativeCompletionCallbacks.size === 0 && nativeCompletionCancel) {
    const cancel = nativeCompletionCancel;
    nativeCompletionCancel = null;
    cancel();
  }
}

function isTimingAnimation(value: unknown): value is TimingAnimation {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as TimingAnimation).__kind === "timing",
  );
}

function isSpringAnimation(value: unknown): value is SpringAnimation {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as SpringAnimation).__kind === "spring",
  );
}

/**
 * Creates a timing animation descriptor. Assign to a `SharedValue` to start.
 * Falls back to a JS-thread RAF loop when no native driver is available.
 */
export function withTiming(
  toValue: number,
  config?: TimingConfig,
): TimingAnimation {
  return { __kind: "timing", toValue, config } as TimingAnimation;
}

/**
 * Creates a spring animation descriptor. Assign to a `SharedValue` to start.
 * Falls back to a JS-thread spring simulation when no native driver is available.
 */
export function withSpring(
  toValue: number,
  config?: SpringConfig,
): SpringAnimation {
  return { __kind: "spring", toValue, config } as SpringAnimation;
}

/**
 * Creates a shared value that is backed by a native shared value on the UI thread
 * when running on a native platform with an active native driver.
 *
 * Setting `.value` to a plain value updates immediately.
 * Setting `.value` to a `withTiming()` or `withSpring()` result drives the animation.
 */
export function createSharedValue<T>(initialValue: T): SharedValue<T> {
  const [signal, setSignal] = createSharedSignal(initialValue);
  const nativeId =
    typeof initialValue === "number"
      ? ((signal as SharedSignalAccessor<number>).__zynth_shared_signal_id ??
        null)
      : null;
  let cachedValue = initialValue;
  let cancelActive: (() => void) | null = null;
  let finishCallback: AnimationCallback | null = null;
  let warnedJsAnimationFallback = false;
  let nativeCompletionCallbackId: number | null = null;

  const cancelAnimation = (finished: boolean): void => {
    const active = cancelActive;
    cancelActive = null;
    if (active) {
      active();
    }
    const callback = finishCallback;
    finishCallback = null;
    if (callback) {
      callback(finished);
    }
  };

  const setImmediate = (next: T): void => {
    cancelAnimation(false);
    if (nativeId !== null) {
      const canceled = cancelNativeSharedValue(nativeId);
      if (!canceled && nativeCompletionCallbackId !== null) {
        const callbackId = nativeCompletionCallbackId;
        nativeCompletionCallbackId = null;
        unregisterNativeCompletionCallback(callbackId);
      }
    }
    setSignal(() => next);
    cachedValue = next;
  };

  const syncFromNativeIfAvailable = (): void => {
    if (nativeId === null || !hasNativeAnimate()) return;
    const nativeCurrent = getNativeSharedValue(nativeId);
    if (typeof nativeCurrent !== "number" || !Number.isFinite(nativeCurrent)) {
      return;
    }
    const typedValue = nativeCurrent as T;
    cachedValue = typedValue;
    setSignal(() => typedValue);
  };

  const startTiming = (request: TimingAnimation): void => {
    cancelAnimation(false);
    const from = readSharedSignal(signal);
    const to = request.toValue;
    const config = request.config;
    const duration = config?.duration ?? DEFAULT_DURATION;
    const easing = config?.easing ?? Easing.out(Easing.cubic);
    const delay = config?.delay ?? 0;
    finishCallback = config?.onFinish ?? null;

    const fromValue = typeof from === "number" ? from : NaN;
    if (Number.isNaN(fromValue) || duration <= 0) {
      setSignal(() => to as T);
      cancelAnimation(true);
      return;
    }

    const startTime = now() + delay;
    cancelActive = startAnimation((time) => {
      if (time < startTime) return false;
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easing(progress);
      const nextValue = fromValue + (to - fromValue) * eased;
      if (!Number.isFinite(nextValue)) {
        setSignal(() => to as T);
        cancelAnimation(true);
        return true;
      }
      setSignal(() => nextValue as T);
      if (progress >= 1) {
        cancelAnimation(true);
        return true;
      }
      return false;
    });
  };

  const startSpring = (request: SpringAnimation): void => {
    cancelAnimation(false);
    const from = readSharedSignal(signal);
    const to = request.toValue;
    const config = request.config;
    const damping = config?.damping ?? DEFAULT_DAMPING;
    const stiffness = config?.stiffness ?? DEFAULT_STIFFNESS;
    const mass = config?.mass ?? DEFAULT_MASS;
    const restSpeed = config?.restSpeedThreshold ?? DEFAULT_REST_SPEED;
    const restDisplacement =
      config?.restDisplacementThreshold ?? DEFAULT_REST_DISPLACEMENT;
    const overshootClamping = config?.overshootClamping ?? false;
    const delay = config?.delay ?? 0;
    finishCallback = config?.onFinish ?? null;

    const fromValue = typeof from === "number" ? from : NaN;
    if (Number.isNaN(fromValue)) {
      setSignal(() => to as T);
      cancelAnimation(true);
      return;
    }

    let position = fromValue;
    let velocity = config?.velocity ?? 0;
    let lastTime = 0;
    const startTime = now() + delay;
    const direction = to - fromValue;

    cancelActive = startAnimation((time) => {
      if (time < startTime) return false;
      if (lastTime === 0) {
        lastTime = time;
        setSignal(() => position as T);
        return false;
      }
      const deltaMs = Math.min(time - lastTime, 64);
      lastTime = time;
      const delta = deltaMs / 1000;
      const displacement = position - to;
      const springForce = -stiffness * displacement;
      const dampingForce = -damping * velocity;
      const acceleration = (springForce + dampingForce) / mass;
      velocity += acceleration * delta;
      position += velocity * delta;
      if (!Number.isFinite(position)) {
        setSignal(() => to as T);
        cancelAnimation(true);
        return true;
      }

      if (overshootClamping && direction !== 0) {
        if (direction > 0 && position > to) {
          position = to;
          velocity = 0;
        } else if (direction < 0 && position < to) {
          position = to;
          velocity = 0;
        }
      }

      setSignal(() => position as T);

      if (
        Math.abs(velocity) <= restSpeed &&
        Math.abs(displacement) <= restDisplacement
      ) {
        setSignal(() => to as T);
        cancelAnimation(true);
        return true;
      }
      return false;
    });
  };

  const shared: SharedValue<T> = {
    get value() {
      return signal();
    },
    set value(next: T) {
      const animationRequest = isTimingAnimation(next)
        ? next
        : isSpringAnimation(next)
          ? next
          : null;
      const animationConfig = animationRequest?.config;
      if (nativeId !== null && animationRequest && hasNativeAnimate()) {
        cancelAnimation(false);
        const config = animationConfig ?? {};
        const payload: Record<string, unknown> = {
          type: animationRequest.__kind,
          toValue: animationRequest.toValue,
        };
        if (typeof config.delay === "number") {
          payload.delay = config.delay;
        }
        if (animationRequest.__kind === "timing") {
          const timingConfig = config as TimingConfig;
          if (typeof timingConfig.duration === "number") {
            payload.duration = timingConfig.duration;
          }
        } else {
          const springConfig = config as SpringConfig;
          if (typeof springConfig.damping === "number") {
            payload.damping = springConfig.damping;
          }
          if (typeof springConfig.stiffness === "number") {
            payload.stiffness = springConfig.stiffness;
          }
          if (typeof springConfig.mass === "number") {
            payload.mass = springConfig.mass;
          }
          if (typeof springConfig.velocity === "number") {
            payload.velocity = springConfig.velocity;
          }
          if (typeof springConfig.restSpeedThreshold === "number") {
            payload.restSpeedThreshold = springConfig.restSpeedThreshold;
          }
          if (typeof springConfig.restDisplacementThreshold === "number") {
            payload.restDisplacementThreshold =
              springConfig.restDisplacementThreshold;
          }
          if (typeof springConfig.overshootClamping === "boolean") {
            payload.overshootClamping = springConfig.overshootClamping;
          }
        }
        if (typeof config.onFinish === "function") {
          const callbackId = registerNativeCompletionCallback((finished) => {
            if (nativeCompletionCallbackId !== callbackId) return;
            nativeCompletionCallbackId = null;
            config.onFinish?.(finished);
          });
          nativeCompletionCallbackId = callbackId;
          payload.callbackId = callbackId;
        } else {
          nativeCompletionCallbackId = null;
        }
        const started = animateNativeSharedValue(nativeId, payload);
        if (started) {
          return;
        }
        if (nativeCompletionCallbackId !== null) {
          const callbackId = nativeCompletionCallbackId;
          nativeCompletionCallbackId = null;
          unregisterNativeCompletionCallback(callbackId);
        }
      }
      if (
        animationRequest &&
        !warnedJsAnimationFallback &&
        (nativeId === null || !hasNativeAnimate())
      ) {
        warnedJsAnimationFallback = true;
        console.warn(
          "Animating shared value on the JS thread. This may cause performance issues. Consider using this animation on a native-driven style property.",
        );
      }
      if (isTimingAnimation(next)) {
        syncFromNativeIfAvailable();
        startTiming(next);
        return;
      }
      if (isSpringAnimation(next)) {
        syncFromNativeIfAvailable();
        startSpring(next);
        return;
      }
      setImmediate(next as T);
    },
    cancelAnimation: () => {
      cancelAnimation(false);
      if (nativeId !== null) {
        const canceled = cancelNativeSharedValue(nativeId);
        if (!canceled && nativeCompletionCallbackId !== null) {
          const callbackId = nativeCompletionCallbackId;
          nativeCompletionCallbackId = null;
          unregisterNativeCompletionCallback(callbackId);
        }
      }
    },
    toSignal: () => signal,
    nativeId: nativeId ?? undefined,
  };

  return shared;
}

function captureSharedValues<T>(fn: () => T): {
  result: T;
  tokens: SharedValueToken[];
} {
  const captured = captureSharedSignals(fn);
  const tokens = captured.tokens as SharedSignalToken[];
  return { result: captured.result, tokens: tokens as SharedValueToken[] };
}

function isSharedValueToken(value: unknown): value is SharedValueToken {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as SharedValueToken)[SHARED_VALUE_MARKER] === "number",
  );
}

function isInterpolatedValueToken(value: unknown): value is InterpolatedValueToken {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as InterpolatedValueToken)[INTERPOLATION_MARKER] === "object",
  );
}

function isDerivedValueToken(value: unknown): value is DerivedValueToken {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as DerivedValueToken)[DERIVED_VALUE_MARKER] === "object",
  );
}

function readAnimatedPreview(
  value: SharedValueToken | InterpolatedValueToken | DerivedValueToken,
): number {
  const current = (value as { __zynth_shared_signal_current?: unknown })
    .__zynth_shared_signal_current;
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

export function deriveAnimatedValue(
  value: number,
  config: DerivedValueConfig = {},
): number {
  const multiplier = config.multiplier ?? 1;
  const offset = config.offset ?? 0;

  if (
    isSharedValueToken(value) ||
    isInterpolatedValueToken(value) ||
    isDerivedValueToken(value)
  ) {
    const current = readAnimatedPreview(value);
    const next = current * multiplier + offset;
    const token: DerivedValueToken = {
      [DERIVED_VALUE_MARKER]: {
        source: value,
        multiplier,
        offset,
      },
      __zynth_shared_signal_current: next,
      valueOf: () => next,
      toString: () => String(next),
    };
    return token as unknown as number;
  }

  return value * multiplier + offset;
}

function resolveTokenValue(value: unknown): {
  value: unknown;
  token?: SharedValueToken;
  interpolation?: NativeStyleMapperConfig["opacity"];
  isDynamicMapped?: boolean;
} {
  if (isSharedValueToken(value)) {
    return {
      value: (value as unknown as { __zynth_shared_signal_current?: unknown }).__zynth_shared_signal_current,
      token: value,
      isDynamicMapped: true,
    };
  }
  if (isInterpolatedValueToken(value)) {
    return {
      value: (value as unknown as { __zynth_shared_signal_current?: unknown }).__zynth_shared_signal_current,
      interpolation: value as NativeStyleMapperConfig["opacity"],
      isDynamicMapped: true,
    };
  }
  if (isDerivedValueToken(value)) {
    return {
      value: (value as unknown as { __zynth_shared_signal_current?: unknown }).__zynth_shared_signal_current,
      interpolation: value as NativeStyleMapperConfig["opacity"],
      isDynamicMapped: true,
    };
  }
  return { value };
}

function isAngleKey(key: string): boolean {
  return (
    key === "rotate" ||
    key === "rotateZ" ||
    key === "rotateX" ||
    key === "rotateY" ||
    key === "skewX" ||
    key === "skewY"
  );
}

function normalizeAngleValue(value: unknown): unknown {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return `${value}deg`;
  }
  return value;
}

type AnimatableLayoutKey =
  | "width"
  | "height"
  | "minWidth"
  | "minHeight"
  | "maxWidth"
  | "maxHeight"
  | "flex"
  | "flexGrow"
  | "flexShrink"
  | "flexBasis"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "padding"
  | "paddingHorizontal"
  | "paddingVertical"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "margin"
  | "marginHorizontal"
  | "marginVertical"
  | "marginTop"
  | "marginRight"
  | "marginBottom"
  | "marginLeft";

function applyLayoutStyleMapping(
  style: Style,
  resolved: Style,
  mapping: NativeStyleMapperConfig,
  key: AnimatableLayoutKey,
): boolean {
  const rawValue = (style as Record<string, unknown>)[key];
  if (rawValue === undefined) return false;
  const { value, token, interpolation, isDynamicMapped } =
    resolveTokenValue(rawValue);
  if (isDynamicMapped) {
    delete (resolved as Record<string, unknown>)[key];
  } else {
    (resolved as Record<string, unknown>)[key] = rawValue;
  }
  if (token) {
    mapping[key] = { [SHARED_VALUE_MARKER]: token[SHARED_VALUE_MARKER] };
    return true;
  }
  if (interpolation) {
    mapping[key] = interpolation as NativeStyleMapperConfig[typeof key];
    return true;
  }
  if (typeof value === "number" || typeof value === "string") {
    mapping[key] = value as NativeStyleMapperConfig[typeof key];
  }
  return false;
}

function buildNativeStyleMapping(style: Style): {
  mapping: NativeStyleMapperConfig | null;
  resolved: Style;
} {
  let hasMapping = false;
  const resolved: Style = { ...style };
  const mapping: NativeStyleMapperConfig = {};

  if (style.opacity !== undefined) {
    const { value, token, interpolation, isDynamicMapped } = resolveTokenValue(
      style.opacity,
    );
    if (isDynamicMapped) {
      delete resolved.opacity;
    } else {
      resolved.opacity = value as number;
    }
    if (token) {
      mapping.opacity = { [SHARED_VALUE_MARKER]: token[SHARED_VALUE_MARKER] };
      hasMapping = true;
    } else if (interpolation) {
      mapping.opacity = interpolation;
      hasMapping = true;
    } else if (typeof value === "number" || typeof value === "string") {
      mapping.opacity = value as NativeStyleMapperConfig["opacity"];
    }
  }

  const layoutKeys: AnimatableLayoutKey[] = [
    "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
    "flex", "flexGrow", "flexShrink", "flexBasis",
    "top", "right", "bottom", "left",
    "padding", "paddingHorizontal", "paddingVertical",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginHorizontal", "marginVertical",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
  ];
  for (const layoutKey of layoutKeys) {
    hasMapping =
      applyLayoutStyleMapping(style, resolved, mapping, layoutKey) ||
      hasMapping;
  }

  if (Array.isArray(style.transform)) {
    const resolvedTransforms: Array<Record<string, unknown>> = [];
    const mappedTransforms: Array<Record<string, unknown>> = [];

    for (const entry of style.transform) {
      if (!entry || typeof entry !== "object") continue;
      const nextResolved: Record<string, unknown> = {};
      const nextMapped: Record<string, unknown> = {};

      for (const [key, rawValue] of Object.entries(entry)) {
        const { value, token, interpolation, isDynamicMapped } =
          resolveTokenValue(rawValue);
        const resolvedValue = isAngleKey(key)
          ? normalizeAngleValue(value)
          : value;
        if (!isDynamicMapped) {
          nextResolved[key] = resolvedValue;
        }
        if (token) {
          nextMapped[key] = {
            [SHARED_VALUE_MARKER]: token[SHARED_VALUE_MARKER],
          };
          hasMapping = true;
        } else if (interpolation) {
          nextMapped[key] = interpolation;
          hasMapping = true;
        } else {
          const mappedValue = isAngleKey(key)
            ? normalizeAngleValue(value)
            : value;
          nextMapped[key] = mappedValue as NativeStyleMapperConfig["opacity"];
        }
      }

      if (Object.keys(nextResolved).length > 0) {
        resolvedTransforms.push(nextResolved);
      }
      if (Object.keys(nextMapped).length > 0) {
        mappedTransforms.push(nextMapped);
      }
    }

    if (resolvedTransforms.length > 0) {
      resolved.transform = resolvedTransforms as typeof style.transform;
    }
    if (mappedTransforms.length > 0) {
      mapping.transform =
        mappedTransforms as NativeStyleMapperConfig["transform"];
    }
  }

  return {
    mapping: hasMapping ? mapping : null,
    resolved,
  };
}

type AnimatedStyleAccessor = Accessor<Style> & {
  __zynthAnimatedStyle?: {
    getMapping: () => NativeStyleMapperConfig | null;
  };
};

/**
 * Creates a reactive style accessor that carries native style mapper metadata.
 *
 * When used on a motion-capable primitive (e.g. `<View>`), the native style
 * mapper is attached lazily on mount and removed on cleanup — no wrapper
 * component required.
 *
 * @example
 * ```tsx
 * const scale = createSharedValue(1);
 * const style = createAnimatedStyle(() => ({
 *   transform: [{ scale: scale.value }],
 * }));
 * <View style={style} />
 * ```
 */
export function createAnimatedStyle(getStyle: () => Style): AnimatedStyleAccessor {
  const nativeEnabled = isNativePlatform() && hasNativeAnimate();
  if (!nativeEnabled) {
    return createMemo(
      () => buildNativeStyleMapping(getStyle()).resolved,
    ) as AnimatedStyleAccessor;
  }

  const memo = createMemo(() => {
    const { result } = captureSharedValues(() => getStyle());
    return buildNativeStyleMapping(result);
  });

  const accessor: AnimatedStyleAccessor = (() =>
    memo().resolved) as AnimatedStyleAccessor;
  accessor.__zynthAnimatedStyle = {
    getMapping: () => memo().mapping,
  };

  return accessor;
}
