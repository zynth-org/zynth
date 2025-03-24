const DIMENSIONS_EVENT = "rune.dimensions.change";
const EPSILON = 0.01;

type DimensionKey = "window" | "screen";

export type DimensionMetrics = Readonly<{
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}>;

export type DimensionsSnapshot = Readonly<{
  window: DimensionMetrics;
  screen: DimensionMetrics;
}>;

export type DimensionsUpdateSource = "initial" | "native" | "refresh" | "fallback";

export type DimensionsUpdateMeta = Readonly<{
  source: DimensionsUpdateSource;
  changed: readonly DimensionKey[];
  timestamp: number;
}>;

export type DimensionsListener = (
  snapshot: DimensionsSnapshot,
  meta: DimensionsUpdateMeta
) => void;

type NativeEmitterSubscription = { remove(): void };

type NativeEmitter = {
  addListener(event: string, listener: (payload: unknown) => void): NativeEmitterSubscription;
  removeListener?(event: string, listener: (payload: unknown) => void): void;
};

type ModulesBridge = {
  call?(name: string, method: string, args?: unknown): Promise<unknown> | unknown;
  callSync?(name: string, method: string, args?: unknown): unknown;
};

type DimensionsInitOptions = {
  source: DimensionsUpdateSource;
};

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as any;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function approxEqual(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= EPSILON;
}

function metricsEqual(a: DimensionMetrics, b: DimensionMetrics): boolean {
  return (
    approxEqual(a.width, b.width) &&
    approxEqual(a.height, b.height) &&
    approxEqual(a.scale, b.scale) &&
    approxEqual(a.fontScale, b.fontScale)
  );
}

function freezeSnapshot(snapshot: DimensionsSnapshot): DimensionsSnapshot {
  const windowMetrics = Object.freeze({ ...snapshot.window });
  const screenMetrics = Object.freeze({ ...snapshot.screen });
  return Object.freeze({
    window: windowMetrics,
    screen: screenMetrics,
  });
}

function normalizeMetrics(input: unknown): DimensionMetrics | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const scale = Number(
    typeof candidate.scale === "number" && !Number.isNaN(candidate.scale)
      ? candidate.scale
      : candidate.pixelRatio
  );
  const fontScale = Number(
    typeof candidate.fontScale === "number" && !Number.isNaN(candidate.fontScale)
      ? candidate.fontScale
      : 1
  );

  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    Number.isFinite(scale) &&
    Number.isFinite(fontScale)
  ) {
    return {
      width,
      height,
      scale,
      fontScale,
    };
  }
  return null;
}

function normalizeSnapshot(input: unknown): DimensionsSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const windowMetrics = normalizeMetrics(value.window);
  const screenMetrics = normalizeMetrics(value.screen);
  if (!windowMetrics || !screenMetrics) {
    return null;
  }
  return {
    window: windowMetrics,
    screen: screenMetrics,
  };
}

function unwrapNativeResult(value: unknown): DimensionsSnapshot | null {
  const direct = normalizeSnapshot(value);
  if (direct) return direct;

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.result !== undefined) {
      const snapshot = normalizeSnapshot(record.result);
      if (snapshot) return snapshot;
    }
    if (record.data !== undefined) {
      const snapshot = normalizeSnapshot(record.data);
      if (snapshot) return snapshot;
    }
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return unwrapNativeResult(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

function readNativeConstants(): DimensionsSnapshot | null {
  const globalObj = getGlobalObject();
  const constants = globalObj.NativeConstants as Record<string, unknown> | undefined;
  if (!constants) return null;
  const snapshot = constants.Dimensions ?? constants.dimensions;
  return normalizeSnapshot(snapshot);
}

function readHostWindow(): DimensionsSnapshot | null {
  const globalObj = getGlobalObject() as typeof globalThis & {
    innerWidth?: number;
    innerHeight?: number;
    screen?: { width?: number; height?: number };
    devicePixelRatio?: number;
  };

  const width = globalObj.innerWidth;
  const height = globalObj.innerHeight;
  if (typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  const scale = typeof globalObj.devicePixelRatio === "number" ? globalObj.devicePixelRatio : 1;
  const screenWidth =
    typeof globalObj.screen?.width === "number" ? globalObj.screen!.width : width;
  const screenHeight =
    typeof globalObj.screen?.height === "number" ? globalObj.screen!.height : height;

  return {
    window: {
      width,
      height,
      scale,
      fontScale: 1,
    },
    screen: {
      width: screenWidth,
      height: screenHeight,
      scale,
      fontScale: 1,
    },
  };
}

function diffSnapshots(
  previous: DimensionsSnapshot,
  next: DimensionsSnapshot
): readonly DimensionKey[] {
  const changed: DimensionKey[] = [];
  if (!metricsEqual(previous.window, next.window)) {
    changed.push("window");
  }
  if (!metricsEqual(previous.screen, next.screen)) {
    changed.push("screen");
  }
  return changed;
}

const listeners = new Set<DimensionsListener>();

const defaultMetrics: DimensionMetrics = Object.freeze({
  width: 0,
  height: 0,
  scale: 1,
  fontScale: 1,
});

let currentSnapshot: DimensionsSnapshot = Object.freeze({
  window: defaultMetrics,
  screen: defaultMetrics,
});

bootstrapInitialSnapshot({ source: "initial" });

function bootstrapInitialSnapshot({ source }: DimensionsInitOptions): void {
  const nativeConstants = readNativeConstants();
  if (nativeConstants) {
    updateState(nativeConstants, source, { silent: true });
    return;
  }

  const hostWindow = readHostWindow();
  if (hostWindow) {
    updateState(hostWindow, "fallback", { silent: true });
    return;
  }
}

function updateState(
  snapshot: DimensionsSnapshot,
  source: DimensionsUpdateSource,
  options?: { silent?: boolean }
): DimensionsSnapshot {
  const normalized = freezeSnapshot(snapshot);
  const changed = diffSnapshots(currentSnapshot, normalized);
  currentSnapshot = normalized;
  if (options?.silent || changed.length === 0) {
    return currentSnapshot;
  }

  const meta: DimensionsUpdateMeta = Object.freeze({
    source,
    changed,
    timestamp: Date.now(),
  });

  if (listeners.size > 0) {
    const snapshotListeners = Array.from(listeners);
    for (const listener of snapshotListeners) {
      try {
        listener(currentSnapshot, meta);
      } catch (error) {
        console.error("[Dimensions] listener threw", error);
      }
    }
  }

  return currentSnapshot;
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = globalObj.__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

async function requestNativeSnapshot(): Promise<DimensionsSnapshot | null> {
  const bridge = getModulesBridge();
  if (bridge?.callSync) {
    try {
      const result = bridge.callSync("Dimensions", "current");
      const snapshot = unwrapNativeResult(result);
      if (snapshot) {
        return snapshot;
      }
    } catch (error) {
      console.warn("[Dimensions] callSync failed", error);
    }
  }

  if (bridge?.call) {
    try {
      const maybeResult = bridge.call("Dimensions", "current", null);
      const result =
        maybeResult instanceof Promise ? await maybeResult : await Promise.resolve(maybeResult);
      const snapshot = unwrapNativeResult(result);
      if (snapshot) {
        return snapshot;
      }
    } catch (error) {
      console.warn("[Dimensions] call failed", error);
    }
  }

  return readNativeConstants();
}

function attachNativeEmitter(): NativeEmitterSubscription | null {
  const emitter = getGlobalObject().RuneNativeEmitter as NativeEmitter | undefined;
  if (!emitter || typeof emitter.addListener !== "function") {
    return null;
  }

  const subscription = emitter.addListener(DIMENSIONS_EVENT, (payload: unknown) => {
    const snapshot = unwrapNativeResult(payload);
    if (!snapshot) {
      return;
    }
    updateState(snapshot, "native");
  });

  return subscription;
}

const nativeSubscription = attachNativeEmitter();

export type SubscribeOptions = {
  emitCurrent?: boolean;
};

export class Dimensions {
  static get current(): DimensionsSnapshot {
    return currentSnapshot;
  }

  static get(type: DimensionKey): DimensionMetrics {
    return currentSnapshot[type];
  }

  static all(): DimensionsSnapshot {
    return currentSnapshot;
  }

  static subscribe(listener: DimensionsListener, options?: SubscribeOptions): () => void {
    listeners.add(listener);
    if (options?.emitCurrent !== false) {
      const meta: DimensionsUpdateMeta = {
        source: "initial",
        changed: ["window", "screen"] as const,
        timestamp: Date.now(),
      };
      listener(currentSnapshot, meta);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        // Keep native subscription alive; it is inexpensive and shared.
      }
    };
  }

  static observe(
    key: DimensionKey,
    listener: (metrics: DimensionMetrics, meta: DimensionsUpdateMeta) => void,
    options?: SubscribeOptions
  ): () => void {
    return Dimensions.subscribe((snapshot, meta) => {
      if (options?.emitCurrent === false && meta.source === "initial") {
        return;
      }
      if (meta.changed.length === 0 && meta.source !== "initial") {
        return;
      }
      if (meta.changed.includes(key) || meta.source === "initial") {
        listener(snapshot[key], meta);
      }
    }, options);
  }

  static async refresh(): Promise<DimensionsSnapshot> {
    const snapshot =
      (await requestNativeSnapshot()) ??
      readHostWindow() ??
      currentSnapshot;
    return updateState(snapshot, "refresh");
  }

  static detach(): void {
    nativeSubscription?.remove();
  }
}
