import { INTERPOLATION_MARKER, SHARED_VALUE_MARKER } from "./native";

export enum Extrapolation {
  IDENTITY = "identity",
  CLAMP = "clamp",
  EXTEND = "extend",
}

export interface InterpolationConfig {
  extrapolateLeft?: Extrapolation;
  extrapolateRight?: Extrapolation;
}

type SharedValueTokenLike = {
  [SHARED_VALUE_MARKER]: number;
  __zynth_shared_signal_current: number;
};

type InterpolatedValueToken = {
  [INTERPOLATION_MARKER]: {
    source: { [SHARED_VALUE_MARKER]: number };
    inputRange: number[];
    outputRange: number[];
    extrapolateLeft: Extrapolation;
    extrapolateRight: Extrapolation;
  };
  __zynth_shared_signal_current: number;
  valueOf: () => number;
  toString: () => string;
};

function isSharedValueTokenLike(value: unknown): value is SharedValueTokenLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as SharedValueTokenLike)[SHARED_VALUE_MARKER] === "number" &&
      typeof (value as SharedValueTokenLike).__zynth_shared_signal_current ===
        "number",
  );
}

function interpolateNumber(
  value: number,
  inputRange: number[],
  outputRange: number[],
  left: Extrapolation,
  right: Extrapolation,
): number {
  // Find the segment
  let i = 1;
  for (; i < inputRange.length - 1; i++) {
    if (value < inputRange[i]) break;
  }

  const inputMin = inputRange[i - 1];
  const inputMax = inputRange[i];
  const outputMin = outputRange[i - 1];
  const outputMax = outputRange[i];

  if (value < inputMin) {
    if (left === Extrapolation.IDENTITY) return value;
    if (left === Extrapolation.CLAMP) return outputMin;
  }

  if (value > inputMax) {
    if (right === Extrapolation.IDENTITY) return value;
    if (right === Extrapolation.CLAMP) return outputMax;
  }

  const progress = (value - inputMin) / (inputMax - inputMin);
  return outputMin + progress * (outputMax - outputMin);
}

/**
 * Maps an input value from an input range to an output range.
 * When passed a shared value token, produces an interpolated token that can
 * be used directly in animated styles for native-driver execution.
 */
export function interpolate(
  value: number,
  inputRange: number[],
  outputRange: number[],
  extrapolate?: Extrapolation | InterpolationConfig,
): number {
  const config =
    typeof extrapolate === "object"
      ? extrapolate
      : { extrapolateLeft: extrapolate, extrapolateRight: extrapolate };

  const left = config.extrapolateLeft ?? Extrapolation.CLAMP;
  const right = config.extrapolateRight ?? Extrapolation.CLAMP;

  if (inputRange.length !== outputRange.length || inputRange.length < 2) {
    throw new Error(
      "interpolate: inputRange and outputRange must have the same length and at least 2 elements",
    );
  }

  if (isSharedValueTokenLike(value)) {
    const current = interpolateNumber(
      value.__zynth_shared_signal_current,
      inputRange,
      outputRange,
      left,
      right,
    );
    const token: InterpolatedValueToken = {
      [INTERPOLATION_MARKER]: {
        source: { [SHARED_VALUE_MARKER]: value[SHARED_VALUE_MARKER] },
        inputRange: [...inputRange],
        outputRange: [...outputRange],
        extrapolateLeft: left,
        extrapolateRight: right,
      },
      __zynth_shared_signal_current: current,
      valueOf: () => current,
      toString: () => String(current),
    };
    return token as unknown as number;
  }

  return interpolateNumber(value, inputRange, outputRange, left, right);
}
