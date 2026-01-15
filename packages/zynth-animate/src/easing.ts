export type EasingFunction = (t: number) => number;
export type EasingName =
  | "linear"
  | "ease"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeOutCubic";

type NamedEasingFunction = EasingFunction & { __zynthEasingName?: EasingName };

const clamp = (t: number): number => {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
};

const markEasing = (fn: EasingFunction, name: EasingName): NamedEasingFunction => {
  (fn as NamedEasingFunction).__zynthEasingName = name;
  return fn as NamedEasingFunction;
};

const linear = markEasing((t) => t, "linear");
const quad = markEasing((t) => t * t, "easeIn");
const cubic: EasingFunction = (t) => t * t * t;
const ease = markEasing((t) => t * t * (3 - 2 * t), "ease");
const exp: EasingFunction = (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)));

const inFn = (fn: EasingFunction): EasingFunction => (t) => fn(clamp(t));
const outFn = (fn: EasingFunction): EasingFunction => (t) =>
  1 - fn(1 - clamp(t));
const inOutFn = (fn: EasingFunction): EasingFunction => (t) => {
  const clamped = clamp(t);
  if (clamped < 0.5) return fn(clamped * 2) / 2;
  return 1 - fn((1 - clamped) * 2) / 2;
};

const easeOut = markEasing(outFn(quad), "easeOut");
const easeInOut = markEasing(inOutFn(quad), "easeInOut");
const easeOutCubic = markEasing(outFn(cubic), "easeOutCubic");

const easingByName: Record<EasingName, EasingFunction> = {
  linear,
  ease,
  easeIn: quad,
  easeOut,
  easeInOut,
  easeOutCubic,
};

export const Easing = {
  linear,
  quad,
  cubic,
  ease,
  exp,
  in: inFn,
  out: outFn,
  inOut: inOutFn,
  easeIn: quad,
  easeOut,
  easeInOut,
  easeOutCubic,
};

export const resolveEasing = (
  easing?: EasingFunction | EasingName
): EasingFunction => {
  if (!easing) return easingByName.easeOutCubic;
  if (typeof easing === "string") {
    return easingByName[easing] ?? easingByName.easeOutCubic;
  }
  return easing;
};

export const resolveEasingName = (
  easing?: EasingFunction | EasingName
): EasingName => {
  if (!easing) return "easeOutCubic";
  if (typeof easing === "string") return easing as EasingName;
  const named = easing as NamedEasingFunction;
  return named.__zynthEasingName ?? "easeOutCubic";
};
