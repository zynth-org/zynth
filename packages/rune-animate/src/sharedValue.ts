import { createMemo, createSignal, untrack, type Accessor } from "solid-js";
import type { Style } from "@rune/core";
import { Easing, type EasingFunction } from "./easing";
import {
  SHARED_VALUE_MARKER,
  animateNativeSharedValue,
  cancelNativeSharedValue,
  createNativeSharedValue,
  getNativeSharedValue,
  hasNativeAnimate,
  isNativePlatform,
  setNativeSharedValue,
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

export type SharedValue<T> = {
  get value(): T;
  set value(next: T);
  cancelAnimation: () => void;
};

type SharedValueToken = {
  [SHARED_VALUE_MARKER]: number;
  __rune_shared_value_current: number;
  valueOf: () => number;
  toString: () => string;
};

type CaptureContext = {
  tokens: Map<number, SharedValueToken>;
};

let captureContext: CaptureContext | null = null;

const DEFAULT_DURATION = 300;
const DEFAULT_DAMPING = 20;
const DEFAULT_STIFFNESS = 150;
const DEFAULT_MASS = 1;
const DEFAULT_REST_SPEED = 0.001;
const DEFAULT_REST_DISPLACEMENT = 0.001;

function isTimingAnimation(value: unknown): value is TimingAnimation {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as TimingAnimation).__kind === "timing"
  );
}

function isSpringAnimation(value: unknown): value is SpringAnimation {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as SpringAnimation).__kind === "spring"
  );
}

export function withTiming(toValue: number, config?: TimingConfig): TimingAnimation {
  return { __kind: "timing", toValue, config } as TimingAnimation;
}

export function withSpring(toValue: number, config?: SpringConfig): SpringAnimation {
  return { __kind: "spring", toValue, config } as SpringAnimation;
}

export function useSharedValue<T>(initialValue: T): SharedValue<T> {
  const nativeEnabled = isNativePlatform() && hasNativeAnimate();
  let nativeId: number | null = null;
  let cachedValue = initialValue;

  if (nativeEnabled && typeof initialValue === "number") {
    nativeId = createNativeSharedValue(initialValue);
  }

  const [value, setValue] = createSignal<T>(initialValue);
  let cancelActive: (() => void) | null = null;
  let finishCallback: AnimationCallback | null = null;

  const cancelAnimation = (finished: boolean): void => {
    if (cancelActive) {
      cancelActive();
      cancelActive = null;
    }
    if (finishCallback) {
      finishCallback(finished);
      finishCallback = null;
    }
  };

  const setImmediate = (next: T): void => {
    cancelAnimation(false);
    setValue(() => next);
    cachedValue = next;
    if (nativeId !== null && typeof next === "number") {
      setNativeSharedValue(nativeId, next);
    }
  };

  const startTiming = (request: TimingAnimation): void => {
    cancelAnimation(false);
    const from = untrack(value);
    const to = request.toValue;
    const config = request.config;
    const duration = config?.duration ?? DEFAULT_DURATION;
    const easing = config?.easing ?? Easing.out(Easing.cubic);
    const delay = config?.delay ?? 0;
    finishCallback = config?.onFinish ?? null;

    const fromValue = typeof from === "number" ? from : NaN;
    if (Number.isNaN(fromValue) || duration <= 0) {
      setValue(() => to as T);
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
      setValue(() => nextValue as T);
      if (progress >= 1) {
        cancelAnimation(true);
        return true;
      }
      return false;
    });
  };

  const startSpring = (request: SpringAnimation): void => {
    cancelAnimation(false);
    const from = untrack(value);
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
      setValue(() => to as T);
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
        setValue(() => position as T);
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

      if (overshootClamping && direction !== 0) {
        if (direction > 0 && position > to) {
          position = to;
          velocity = 0;
        } else if (direction < 0 && position < to) {
          position = to;
          velocity = 0;
        }
      }

      setValue(() => position as T);

      if (
        Math.abs(velocity) <= restSpeed &&
        Math.abs(displacement) <= restDisplacement
      ) {
        setValue(() => to as T);
        cancelAnimation(true);
        return true;
      }
      return false;
    });
  };

  const shared: SharedValue<T> = {
    get value() {
      if (nativeId !== null && captureContext && typeof cachedValue === "number") {
        const token: SharedValueToken = {
          [SHARED_VALUE_MARKER]: nativeId,
          __rune_shared_value_current: cachedValue,
          valueOf: () => cachedValue as number,
          toString: () => String(cachedValue),
        };
        captureContext.tokens.set(nativeId, token);
        return token as T;
      }
      if (nativeId !== null && typeof cachedValue === "number") {
        const nativeValue = getNativeSharedValue(nativeId);
        if (typeof nativeValue === "number" && !Number.isNaN(nativeValue)) {
          cachedValue = nativeValue as T;
          return nativeValue as T;
        }
      }
      return value();
    },
    set value(next: T) {
      const animationRequest = isTimingAnimation(next)
        ? next
        : isSpringAnimation(next)
          ? next
          : null;
      if (nativeId !== null && animationRequest) {
        const config = animationRequest.config ?? {};
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
            payload.restDisplacementThreshold = springConfig.restDisplacementThreshold;
          }
          if (typeof springConfig.overshootClamping === "boolean") {
            payload.overshootClamping = springConfig.overshootClamping;
          }
        }
        animateNativeSharedValue(nativeId, payload);
        return;
      }
      if (isTimingAnimation(next)) {
        startTiming(next);
        return;
      }
      if (isSpringAnimation(next)) {
        startSpring(next);
        return;
      }
      setImmediate(next as T);
    },
    cancelAnimation: () => {
      cancelAnimation(false);
      if (nativeId !== null) {
        cancelNativeSharedValue(nativeId);
      }
    },
  };

  return shared;
}

function captureSharedValues<T>(fn: () => T): { result: T; tokens: SharedValueToken[] } {
  captureContext = { tokens: new Map() };
  try {
    const result = fn();
    const tokens = Array.from(captureContext.tokens.values());
    return { result, tokens };
  } finally {
    captureContext = null;
  }
}

function isSharedValueToken(value: unknown): value is SharedValueToken {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as SharedValueToken)[SHARED_VALUE_MARKER] === "number"
  );
}

function resolveTokenValue(value: unknown): { value: unknown; token?: SharedValueToken } {
  if (isSharedValueToken(value)) {
    return { value: value.__rune_shared_value_current, token: value };
  }
  return { value };
}

function isRotateKey(key: string): boolean {
  return key === "rotate" || key === "rotateZ";
}

function normalizeRotateValue(value: unknown): unknown {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return `${value}deg`;
  }
  return value;
}

function buildNativeStyleMapping(style: Style): {
  mapping: NativeStyleMapperConfig | null;
  resolved: Style;
} {
  let hasMapping = false;
  const resolved: Style = { ...style };
  const mapping: NativeStyleMapperConfig = {};

  if (style.opacity !== undefined) {
    const { value, token } = resolveTokenValue(style.opacity);
    resolved.opacity = value as number;
    if (token) {
      mapping.opacity = { [SHARED_VALUE_MARKER]: token[SHARED_VALUE_MARKER] };
      hasMapping = true;
    } else if (typeof value === "number" || typeof value === "string") {
      mapping.opacity = value as NativeStyleMapperConfig["opacity"];
    }
  }

  if (Array.isArray(style.transform)) {
    const resolvedTransforms: Array<Record<string, unknown>> = [];
    const mappedTransforms: Array<Record<string, unknown>> = [];

    for (const entry of style.transform) {
      if (!entry || typeof entry !== "object") continue;
      const nextResolved: Record<string, unknown> = {};
      const nextMapped: Record<string, unknown> = {};

      for (const [key, rawValue] of Object.entries(entry)) {
        const { value, token } = resolveTokenValue(rawValue);
        const resolvedValue = isRotateKey(key)
          ? normalizeRotateValue(value)
          : value;
        nextResolved[key] = resolvedValue;
        if (token) {
          nextMapped[key] = { [SHARED_VALUE_MARKER]: token[SHARED_VALUE_MARKER] };
          hasMapping = true;
        } else {
          const mappedValue = isRotateKey(key)
            ? normalizeRotateValue(value)
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
      mapping.transform = mappedTransforms as NativeStyleMapperConfig["transform"];
    }
  }

  return {
    mapping: hasMapping ? mapping : null,
    resolved,
  };
}

type AnimatedStyleAccessor = Accessor<Style> & {
  __runeAnimatedStyle?: {
    getMapping: () => NativeStyleMapperConfig | null;
  };
};

export function useAnimatedStyle(getStyle: () => Style): AnimatedStyleAccessor {
  const nativeEnabled = isNativePlatform() && hasNativeAnimate();
  if (!nativeEnabled) {
    return createMemo(() => buildNativeStyleMapping(getStyle()).resolved) as AnimatedStyleAccessor;
  }

  const memo = createMemo(() => {
    const { result } = captureSharedValues(() => getStyle());
    return buildNativeStyleMapping(result);
  });

  const accessor: AnimatedStyleAccessor = (() => memo().resolved) as AnimatedStyleAccessor;
  accessor.__runeAnimatedStyle = {
    getMapping: () => memo().mapping,
  };

  return accessor;
}
