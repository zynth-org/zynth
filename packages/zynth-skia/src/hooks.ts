import { captureSharedSignals } from "@zynth/core";
import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import { createPath, resolvePathCommands } from "./path";
import { createSkiaValue } from "./shader";
import type {
  SkiaClockOptions,
  SkiaInterpolationToken,
  SkiaPathCommand,
  SkiaPathObject,
  SkiaPathSource,
  SkiaProgressValue,
  SkiaUsePathValueUpdater,
} from "./types";

type AnimateBridge = {
  getSharedValue?: (id: number) => number | undefined;
  animateSharedValue?: (id: number, config: { type: "timing"; toValue: number; duration: number }) => void;
  cancelSharedValue?: (id: number) => void;
};

type SharedAccessor = {
  __zynth_shared_signal_id?: number;
};

type SkiaPathCommandTokenized = {
  type: "moveTo";
  x: number | SkiaInterpolationToken;
  y: number | SkiaInterpolationToken;
} | {
  type: "lineTo";
  x: number | SkiaInterpolationToken;
  y: number | SkiaInterpolationToken;
} | {
  type: "quadTo";
  cpx: number | SkiaInterpolationToken;
  cpy: number | SkiaInterpolationToken;
  x: number | SkiaInterpolationToken;
  y: number | SkiaInterpolationToken;
} | {
  type: "cubicTo";
  cp1x: number | SkiaInterpolationToken;
  cp1y: number | SkiaInterpolationToken;
  cp2x: number | SkiaInterpolationToken;
  cp2y: number | SkiaInterpolationToken;
  x: number | SkiaInterpolationToken;
  y: number | SkiaInterpolationToken;
} | { type: "close" };

function isSharedSignalToken(value: unknown): value is { __zynth_shared_value: number } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { __zynth_shared_value?: unknown }).__zynth_shared_value === "number";
}

function hasTokenizedPathScalars(commands: readonly SkiaPathCommand[]): boolean {
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === "moveTo" || command.type === "lineTo") {
      if (isSharedSignalToken(command.x) || isSharedSignalToken(command.y)) return true;
      continue;
    }
    if (command.type === "quadTo") {
      if (
        isSharedSignalToken(command.cpx)
        || isSharedSignalToken(command.cpy)
        || isSharedSignalToken(command.x)
        || isSharedSignalToken(command.y)
      ) {
        return true;
      }
      continue;
    }
    if (command.type === "cubicTo") {
      if (
        isSharedSignalToken(command.cp1x)
        || isSharedSignalToken(command.cp1y)
        || isSharedSignalToken(command.cp2x)
        || isSharedSignalToken(command.cp2y)
        || isSharedSignalToken(command.x)
        || isSharedSignalToken(command.y)
      ) {
        return true;
      }
    }
  }
  return false;
}

function getSharedSignalId(accessor: unknown): number | null {
  const id = (accessor as SharedAccessor | null | undefined)?.__zynth_shared_signal_id;
  return typeof id === "number" ? id : null;
}

function getAnimateBridge(): AnimateBridge | null {
  const globalObj = globalThis as any;
  const bridge = globalObj.__zynth_animate as AnimateBridge | undefined;
  return bridge ?? null;
}

function readProgressValue(progress: SkiaProgressValue): number {
  const raw = typeof progress === "function" ? progress() : progress;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ensurePathCompatibility(paths: readonly (readonly SkiaPathCommand[])[]): void {
  if (paths.length < 2) {
    throw new Error("createPathInterpolation requires at least 2 output paths");
  }
  const reference = paths[0]!;
  for (let i = 1; i < paths.length; i += 1) {
    const candidate = paths[i]!;
    if (candidate.length !== reference.length) {
      throw new Error("createPathInterpolation paths must have the same number of commands");
    }
    for (let j = 0; j < reference.length; j += 1) {
      if (candidate[j]!.type !== reference[j]!.type) {
        throw new Error("createPathInterpolation paths must have matching command types");
      }
    }
  }
}

function appendPathCommands(path: SkiaPathObject, commands: readonly SkiaPathCommand[]): void {
  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i]!;
    if (command.type === "moveTo") {
      path.moveTo(command.x, command.y);
      continue;
    }
    if (command.type === "lineTo") {
      path.lineTo(command.x, command.y);
      continue;
    }
    if (command.type === "quadTo") {
      path.quadTo(command.cpx, command.cpy, command.x, command.y);
      continue;
    }
    if (command.type === "cubicTo") {
      path.cubicTo(command.cp1x, command.cp1y, command.cp2x, command.cp2y, command.x, command.y);
      continue;
    }
    path.close();
  }
}

function interpolatePathCommands(
  progress: number,
  inputRange: readonly number[],
  outputCommands: readonly (readonly SkiaPathCommand[])[],
): readonly SkiaPathCommand[] {
  if (progress <= inputRange[0]!) {
    return outputCommands[0]!;
  }
  if (progress >= inputRange[inputRange.length - 1]!) {
    return outputCommands[outputCommands.length - 1]!;
  }

  let segmentIndex = 0;
  for (let i = 0; i < inputRange.length - 1; i += 1) {
    const start = inputRange[i]!;
    const end = inputRange[i + 1]!;
    if (progress >= start && progress <= end) {
      segmentIndex = i;
      break;
    }
  }

  const fromProgress = inputRange[segmentIndex]!;
  const toProgress = inputRange[segmentIndex + 1]!;
  const range = toProgress - fromProgress;
  const t = range === 0 ? 0 : Math.max(0, Math.min(1, (progress - fromProgress) / range));

  const from = outputCommands[segmentIndex]!;
  const to = outputCommands[segmentIndex + 1]!;
  const interpolated: SkiaPathCommand[] = [];

  for (let i = 0; i < from.length; i += 1) {
    const a = from[i]!;
    const b = to[i]!;
    if (a.type === "moveTo" && b.type === "moveTo") {
      interpolated.push({ type: "moveTo", x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
      continue;
    }
    if (a.type === "lineTo" && b.type === "lineTo") {
      interpolated.push({ type: "lineTo", x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
      continue;
    }
    if (a.type === "quadTo" && b.type === "quadTo") {
      interpolated.push({
        type: "quadTo",
        cpx: lerp(a.cpx, b.cpx, t),
        cpy: lerp(a.cpy, b.cpy, t),
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
      });
      continue;
    }
    if (a.type === "cubicTo" && b.type === "cubicTo") {
      interpolated.push({
        type: "cubicTo",
        cp1x: lerp(a.cp1x, b.cp1x, t),
        cp1y: lerp(a.cp1y, b.cp1y, t),
        cp2x: lerp(a.cp2x, b.cp2x, t),
        cp2y: lerp(a.cp2y, b.cp2y, t),
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
      });
      continue;
    }
    interpolated.push({ type: "close" });
  }

  return interpolated;
}

function createInterpolationToken(
  signalId: number,
  current: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
): SkiaInterpolationToken {
  return {
    __zynth_shared_value: signalId,
    __zynth_shared_signal_current: current,
    __zynth_skia_interp_input: inputRange,
    __zynth_skia_interp_output: outputRange,
    __zynth_skia_interp_left: "clamp",
    __zynth_skia_interp_right: "clamp",
  };
}

function buildTokenizedPathCommands(
  progressSignalId: number,
  progressCurrent: number,
  inputRange: readonly number[],
  outputCommands: readonly (readonly SkiaPathCommand[])[],
): readonly SkiaPathCommandTokenized[] {
  const head = outputCommands[0]!;
  const next: SkiaPathCommandTokenized[] = [];

  const pickSeries = (
    commandIndex: number,
    pick: (command: SkiaPathCommand) => number,
  ): readonly number[] => {
    const series = new Array<number>(outputCommands.length);
    for (let rangeIndex = 0; rangeIndex < outputCommands.length; rangeIndex += 1) {
      series[rangeIndex] = pick(outputCommands[rangeIndex]![commandIndex]!);
    }
    return series;
  };

  for (let commandIndex = 0; commandIndex < head.length; commandIndex += 1) {
    const command = head[commandIndex]!;
    if (command.type === "moveTo") {
      next.push({
        type: "moveTo",
        x: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "moveTo" }>).x),
        ),
        y: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "moveTo" }>).y),
        ),
      });
      continue;
    }
    if (command.type === "lineTo") {
      next.push({
        type: "lineTo",
        x: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "lineTo" }>).x),
        ),
        y: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "lineTo" }>).y),
        ),
      });
      continue;
    }
    if (command.type === "quadTo") {
      next.push({
        type: "quadTo",
        cpx: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "quadTo" }>).cpx),
        ),
        cpy: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "quadTo" }>).cpy),
        ),
        x: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "quadTo" }>).x),
        ),
        y: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "quadTo" }>).y),
        ),
      });
      continue;
    }
    if (command.type === "cubicTo") {
      next.push({
        type: "cubicTo",
        cp1x: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "cubicTo" }>).cp1x),
        ),
        cp1y: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "cubicTo" }>).cp1y),
        ),
        cp2x: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "cubicTo" }>).cp2x),
        ),
        cp2y: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "cubicTo" }>).cp2y),
        ),
        x: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "cubicTo" }>).x),
        ),
        y: createInterpolationToken(
          progressSignalId,
          progressCurrent,
          inputRange,
          pickSeries(commandIndex, (entry) => (entry as Extract<SkiaPathCommand, { type: "cubicTo" }>).y),
        ),
      });
      continue;
    }
    next.push({ type: "close" });
  }
  return next;
}

export function createClock(options: SkiaClockOptions = {}): Accessor<number> {
  const durationMs = Number.isFinite(options.durationMs ?? NaN) ? Math.max(1, options.durationMs!) : 3_600_000;
  const fallbackStepMs = Number.isFinite(options.fallbackStepMs ?? NaN)
    ? Math.max(8, options.fallbackStepMs!)
    : 16;
  const autoStart = options.autoStart ?? true;

  const [clock, setClock] = createSkiaValue(0, { shared: true });
  const signalId = getSharedSignalId(clock);
  const animateBridge = getAnimateBridge();

  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const stopFallback = () => {
    if (fallbackTimer == null) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  };

  const startFallback = () => {
    stopFallback();
    const startedAt = Date.now() - Math.floor(untrack(clock) * 1000);
    const tick = () => {
      setClock((Date.now() - startedAt) / 1000);
      fallbackTimer = setTimeout(tick, fallbackStepMs);
    };
    fallbackTimer = setTimeout(tick, fallbackStepMs);
  };

  const startNative = () => {
    if (signalId == null || animateBridge == null) return false;
    const getSharedValue = animateBridge.getSharedValue;
    const animateSharedValue = animateBridge.animateSharedValue;
    const cancelSharedValue = animateBridge.cancelSharedValue;
    if (
      typeof getSharedValue !== "function"
      || typeof animateSharedValue !== "function"
      || typeof cancelSharedValue !== "function"
    ) {
      return false;
    }
    const current = Number(getSharedValue(signalId) ?? 0);
    cancelSharedValue(signalId);
    animateSharedValue(signalId, {
      type: "timing",
      toValue: current + durationMs / 1000,
      duration: durationMs,
    });
    return true;
  };

  onMount(() => {
    if (!autoStart) return;
    if (!startNative()) {
      startFallback();
    }
  });

  onCleanup(() => {
    stopFallback();
    if (
      signalId != null
      && animateBridge != null
      && typeof animateBridge.cancelSharedValue === "function"
    ) {
      animateBridge.cancelSharedValue(signalId);
    }
  });

  return clock;
}

export function createPathInterpolation(
  progress: SkiaProgressValue,
  inputRange: readonly number[],
  outputRange: readonly SkiaPathSource[],
): Accessor<SkiaPathObject> {
  if (inputRange.length !== outputRange.length) {
    throw new Error("createPathInterpolation inputRange and outputRange must have the same length");
  }
  if (inputRange.length < 2) {
    throw new Error("createPathInterpolation requires at least 2 range stops");
  }

  const outputCommands = outputRange.map((path) => resolvePathCommands(path));
  ensurePathCompatibility(outputCommands);

  const progressSignalId = getSharedSignalId(progress);
  if (progressSignalId != null) {
    const snapshot = readProgressValue(progress);
    const tokenizedCommands = buildTokenizedPathCommands(
      progressSignalId,
      snapshot,
      inputRange,
      outputCommands,
    );
    const nativePath = createPath(tokenizedCommands as unknown as readonly SkiaPathCommand[]);
    return () => nativePath;
  }

  const mutablePath = createPath(outputCommands[0]!);
  const [version, setVersion] = createSignal(0, { equals: false });

  createEffect(() => {
    const progressValue = readProgressValue(progress);
    const commands = interpolatePathCommands(progressValue, inputRange, outputCommands);
    mutablePath.reset();
    appendPathCommands(mutablePath, commands);
    setVersion((value) => value + 1);
  });

  return () => {
    version();
    return mutablePath;
  };
}

export function createPathValue(
  updater: SkiaUsePathValueUpdater,
  initialPath?: SkiaPathSource,
): Accessor<SkiaPathObject> {
  const baseCommands = resolvePathCommands(initialPath ?? createPath());
  const dynamicPath = createPath(baseCommands);
  dynamicPath.reset();
  appendPathCommands(dynamicPath, baseCommands);
  // Build once under shared-signal capture. If updater writes token scalars to the path,
  // Skia can resolve them natively at draw-time without JS-driven path recompute.
  captureSharedSignals(() => {
    updater(dynamicPath);
    return 0;
  });

  if (hasTokenizedPathScalars(dynamicPath.commands)) {
    return () => dynamicPath;
  }

  const mutablePath = createPath(baseCommands);
  const [version, setVersion] = createSignal(0, { equals: false });

  createEffect(() => {
    mutablePath.reset();
    appendPathCommands(mutablePath, baseCommands);
    updater(mutablePath);
    setVersion((value) => value + 1);
  });

  return () => {
    version();
    return mutablePath;
  };
}

// Compatibility aliases while consumers migrate to Solid-style createXxx APIs.
export const useClock = createClock;
export const usePathInterpolation = createPathInterpolation;
export const usePathValue = createPathValue;
