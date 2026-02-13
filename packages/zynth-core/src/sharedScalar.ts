import type { SharedSignalAccessor as CoreSharedSignalAccessor } from "./sharedSignal";

export type SharedSignalAccessor = (() => number) & {
  __zynth_shared_signal_id?: number;
  __zynth_shared_signal_current?: number;
};

export type SharedScalarRef = {
  kind: "shared";
  signalId: number;
  snapshot: number;
};

export type SharedScalarExtrapolation = "clamp" | "extend" | "identity";

export type InterpolatedScalarRef = {
  kind: "interpolate";
  signalId: number;
  snapshot: number;
  input: readonly number[];
  output: readonly number[];
  left?: SharedScalarExtrapolation;
  right?: SharedScalarExtrapolation;
};

export type SharedScalarValue = number | SharedScalarRef | InterpolatedScalarRef;

type InterpolateSharedOptions = {
  left?: SharedScalarExtrapolation;
  right?: SharedScalarExtrapolation;
};

function validateSharedSignalId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Shared scalar requires a valid shared signal id (__zynth_shared_signal_id)",
    );
  }
  return value;
}

function toFiniteNumber(value: unknown, message: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(message);
  }
  return numeric;
}

function getSnapshot(signal: SharedSignalAccessor): number {
  if (signal.__zynth_shared_signal_current !== undefined) {
    return toFiniteNumber(
      signal.__zynth_shared_signal_current,
      "Shared scalar snapshot must be a finite number",
    );
  }
  return toFiniteNumber(
    signal(),
    "Shared scalar snapshot accessor() must return a finite number",
  );
}

function validateRange(
  values: readonly number[],
  field: "input" | "output",
): number[] {
  if (values.length < 2) {
    throw new Error("interpolateShared requires at least two points");
  }
  const out = new Array<number>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    out[index] = toFiniteNumber(
      values[index],
      `interpolateShared ${field}[${index}] must be a finite number`,
    );
  }
  return out;
}

export function toSharedScalar(signal: SharedSignalAccessor): SharedScalarRef {
  const accessor = signal as CoreSharedSignalAccessor<number>;
  const signalId = validateSharedSignalId(accessor.__zynth_shared_signal_id);
  return {
    kind: "shared",
    signalId,
    snapshot: getSnapshot(accessor as unknown as SharedSignalAccessor),
  };
}

export function interpolateShared(
  signal: SharedSignalAccessor,
  input: readonly number[],
  output: readonly number[],
  options: InterpolateSharedOptions = {},
): InterpolatedScalarRef {
  if (input.length !== output.length) {
    throw new Error("interpolateShared input and output ranges must have identical length");
  }
  const shared = toSharedScalar(signal);
  const inputRange = validateRange(input, "input");
  const outputRange = validateRange(output, "output");
  return {
    kind: "interpolate",
    signalId: shared.signalId,
    snapshot: shared.snapshot,
    input: inputRange,
    output: outputRange,
    left: options.left,
    right: options.right,
  };
}
