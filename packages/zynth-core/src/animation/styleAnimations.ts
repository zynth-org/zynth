import type { Style } from "../host/HostTypes";
import {
  Easing,
  resolveEasing,
  resolveEasingName,
  type EasingFunction,
  type EasingName,
} from "./easing";
import { now, startAnimation } from "./runtime";

export type EntryExitAnimation = {
  from?: Style;
  to?: Style;
  duration?: number;
  delay?: number;
  easing?: EasingFunction | EasingName;
};

export class AnimationBuilder {
  private readonly config: EntryExitAnimation;

  constructor(config: EntryExitAnimation) {
    this.config = config;
  }

  build(): EntryExitAnimation {
    return { ...this.config };
  }

  with(config: EntryExitAnimation): AnimationBuilder {
    return new AnimationBuilder({ ...this.config, ...config });
  }

  duration(duration: number): AnimationBuilder {
    return new AnimationBuilder({ ...this.config, duration });
  }

  delay(delay: number): AnimationBuilder {
    return new AnimationBuilder({ ...this.config, delay });
  }

  easing(easing: EasingFunction | EasingName): AnimationBuilder {
    return new AnimationBuilder({ ...this.config, easing });
  }

  from(from: Style): AnimationBuilder {
    return new AnimationBuilder({ ...this.config, from });
  }

  to(to: Style): AnimationBuilder {
    return new AnimationBuilder({ ...this.config, to });
  }
}

export const createEntryExitAnimation = (
  config: EntryExitAnimation
): AnimationBuilder => {
  return new AnimationBuilder(config);
};

export type KeyframeStyle = Style & {
  easing?: EasingFunction | EasingName;
};

export type KeyframeFrame = {
  at: number;
  style: Style;
  easing?: EasingFunction;
};

export type ResolvedStyleAnimation =
  | {
      kind: "timing";
      from: Style;
      to: Style;
      duration: number;
      delay: number;
      easing: EasingFunction;
    }
  | {
      kind: "keyframe";
      frames: KeyframeFrame[];
      duration: number;
      delay: number;
    };

export class Keyframe {
  private frames: Record<number, KeyframeStyle>;
  private duration?: number;
  private delay?: number;

  constructor(
    frames: Record<number, KeyframeStyle>,
    config?: { duration?: number; delay?: number }
  ) {
    this.frames = frames;
    this.duration = config?.duration;
    this.delay = config?.delay;
  }

  build(): ResolvedStyleAnimation {
    const keys = Object.keys(this.frames)
      .map((key) => Number(key))
      .filter((key) => !Number.isNaN(key))
      .sort((a, b) => a - b);

    const builtFrames: KeyframeFrame[] = [];
    let lastStyle: Style = {};

    for (const key of keys) {
      const frame = this.frames[key];
      if (!frame) continue;
      const { easing, ...style } = frame;
      lastStyle = { ...lastStyle, ...style };
      builtFrames.push({
        at: key / 100,
        style: lastStyle,
        easing: easing ? resolveEasing(easing) : undefined,
      });
    }

    return {
      kind: "keyframe",
      frames: builtFrames,
      duration: this.duration ?? 300,
      delay: this.delay ?? 0,
    };
  }
}

export type EntryExitAnimationLike = EntryExitAnimation | AnimationBuilder;

export function resolveEntryExitAnimation(
  input?: EntryExitAnimationLike
): EntryExitAnimation | null {
  if (!input) return null;
  if (input instanceof AnimationBuilder) return input.build();
  return input;
}

export function resolveStyleAnimation(
  input?: EntryExitAnimationLike | Keyframe
): ResolvedStyleAnimation | null {
  if (!input) return null;
  if (input instanceof Keyframe) return input.build();
  const resolved = resolveEntryExitAnimation(input);
  if (!resolved) return null;
  return {
    kind: "timing",
    from: resolved.from ?? {},
    to: resolved.to ?? {},
    duration: resolved.duration ?? 300,
    delay: resolved.delay ?? 0,
    easing: resolveEasing(resolved.easing),
  };
}

export function getInitialStyle(resolved: ResolvedStyleAnimation): Style {
  if (resolved.kind === "timing") {
    return resolved.from;
  }
  return resolved.frames[0]?.style ?? {};
}

export function getFinalStyle(resolved: ResolvedStyleAnimation): Style {
  if (resolved.kind === "timing") {
    return resolved.to;
  }
  return resolved.frames[resolved.frames.length - 1]?.style ?? {};
}

export function runStyleAnimation(
  resolved: ResolvedStyleAnimation,
  setStyle: (style: Style) => void,
  onFinish?: (finished: boolean) => void
): () => void {
  let finished = false;
  const finalize = (result: boolean): void => {
    if (finished) return;
    finished = true;
    onFinish?.(result);
  };

  if (resolved.kind === "timing") {
    const { from, to, duration, delay, easing } = resolved;
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    const startTime = now() + delay;

    const cancel = startAnimation((time) => {
      if (time < startTime) return false;
      const elapsed = time - startTime;
      const progress = duration <= 0 ? 1 : Math.min(elapsed / duration, 1);
      const eased = easing(progress);
      const nextStyle: Record<string, Style[keyof Style]> = {};
      for (const key of keys) {
        const fromValue = (from as Record<string, unknown>)[key];
        const toValue = (to as Record<string, unknown>)[key];
        nextStyle[key] = interpolateValue(
          fromValue ?? toValue,
          toValue ?? fromValue,
          eased
        ) as Style[keyof Style];
      }
      setStyle(nextStyle as Style);
      if (progress >= 1) {
        finalize(true);
        return true;
      }
      return false;
    });

    return () => {
      cancel();
      finalize(false);
    };
  }

  const { frames, duration, delay } = resolved;
  const startTime = now() + delay;
  const lastFrame = frames[frames.length - 1];

  const cancel = startAnimation((time) => {
    if (time < startTime) return false;
    const elapsed = time - startTime;
    const progress = duration <= 0 ? 1 : Math.min(elapsed / duration, 1);

    if (frames.length === 0) {
      finalize(true);
      return true;
    }

    if (progress <= frames[0].at) {
      setStyle(frames[0].style);
    } else if (progress >= (lastFrame?.at ?? 1)) {
      setStyle(lastFrame?.style ?? {});
    } else {
      const segment = findSegment(frames, progress);
      if (segment) {
        const { from, to } = segment;
        const segmentProgress =
          (progress - from.at) / Math.max(to.at - from.at, 0.0001);
        const eased = (to.easing ?? Easing.linear)(segmentProgress);
        setStyle(interpolateStyle(from.style, to.style, eased));
      }
    }

    if (progress >= 1) {
      finalize(true);
      return true;
    }
    return false;
  });

  return () => {
    cancel();
    finalize(false);
  };
}

/** Pre-built fade-in animation: opacity 0 → 1 over 200ms. */
export const FadeIn: AnimationBuilder = createEntryExitAnimation({
  from: { opacity: 0 },
  to: { opacity: 1 },
  duration: 200,
  easing: "easeOutCubic",
});

/** Pre-built fade-out animation: opacity 1 → 0 over 200ms. */
export const FadeOut: AnimationBuilder = createEntryExitAnimation({
  from: { opacity: 1 },
  to: { opacity: 0 },
  duration: 200,
  easing: "easeOutCubic",
});

export const resolveNativeEasing = (
  easing?: EasingFunction | EasingName
): EasingName => {
  return resolveEasingName(easing);
};

function findSegment(
  frames: KeyframeFrame[],
  progress: number
): { from: KeyframeFrame; to: KeyframeFrame } | null {
  for (let i = 1; i < frames.length; i += 1) {
    if (progress <= frames[i].at) {
      return { from: frames[i - 1], to: frames[i] };
    }
  }
  return null;
}

type ParsedUnit = { value: number; unit: string };

function parseUnitValue(value: unknown): ParsedUnit | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(deg|rad|%|px)$/);
  if (!match) return null;
  return { value: Number(match[1]), unit: match[2] };
}

function interpolateTransform(
  from: Record<string, number | string>[],
  to: Record<string, number | string>[],
  progress: number
): Record<string, number | string>[] {
  if (from.length !== to.length) {
    return progress < 1 ? from : to;
  }

  const result: Record<string, number | string>[] = [];

  for (let i = 0; i < from.length; i += 1) {
    const fromItem = from[i];
    const toItem = to[i];
    const fromKeys = Object.keys(fromItem);
    const toKeys = Object.keys(toItem);
    if (
      fromKeys.length !== 1 ||
      toKeys.length !== 1 ||
      fromKeys[0] !== toKeys[0]
    ) {
      return progress < 1 ? from : to;
    }
    const key = fromKeys[0];
    const value = interpolateValue(fromItem[key], toItem[key], progress);
    result.push({ [key]: value as number | string });
  }

  return result;
}

function interpolateValue(from: unknown, to: unknown, progress: number): unknown {
  if (typeof from === "number" && typeof to === "number") {
    return from + (to - from) * progress;
  }

  const fromUnit = parseUnitValue(from);
  const toUnit = parseUnitValue(to);
  if (fromUnit && toUnit && fromUnit.unit === toUnit.unit) {
    const value = fromUnit.value + (toUnit.value - fromUnit.value) * progress;
    return `${value}${fromUnit.unit}`;
  }

  if (Array.isArray(from) && Array.isArray(to)) {
    return interpolateTransform(
      from as Record<string, number | string>[],
      to as Record<string, number | string>[],
      progress
    );
  }

  return progress < 1 ? from : to;
}

function interpolateStyle(from: Style, to: Style, progress: number): Style {
  const result: Record<string, Style[keyof Style]> = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    const fromValue = (from as Record<string, unknown>)[key];
    const toValue = (to as Record<string, unknown>)[key];
    result[key] = interpolateValue(
      fromValue ?? toValue,
      toValue ?? fromValue,
      progress
    ) as Style[keyof Style];
  }
  return result as Style;
}
