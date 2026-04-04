import { callNative } from "./bridge";

export type PerformanceOverlayStats = {
  enabled: boolean;
  ramMb: number;
  views: number;
  uiFps: number;
  jsFps: number;
};

export type AxonMetricsHarnessOptions = {
  label?: string;
  delayMs?: number;
  batchKind?: string;
  surfaceId?: number;
};

export type AxonTextMeasureMode = "java" | "fallback";

function normalizeStats(value: unknown): PerformanceOverlayStats | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const asNumber = (entry: unknown): number => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return 0;
    }
    return Math.max(0, Math.round(entry));
  };
  return {
    enabled: Boolean(record.enabled),
    ramMb: asNumber(record.ramMb),
    views: asNumber(record.views),
    uiFps: asNumber(record.uiFps),
    jsFps: asNumber(record.jsFps),
  };
}

/**
 * Toggles the native performance HUD rendered above routes/surfaces.
 */
export async function setPerformanceOverlayEnabled(
  enabled: boolean
): Promise<boolean> {
  try {
    await callNative("Devtools", "setPerformanceOverlayEnabled", { enabled });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a native snapshot for RAM, node count, UI FPS and JS FPS.
 */
export async function getPerformanceOverlayStats(): Promise<PerformanceOverlayStats | null> {
  try {
    const result = await callNative<unknown>(
      "Devtools",
      "getPerformanceOverlayStats",
      {}
    );
    return normalizeStats(result);
  } catch {
    return null;
  }
}

/**
 * Enables a native Axon metrics harness for the next matching startup/layout batch.
 */
export async function enableAxonMetricsHarness(
  options: AxonMetricsHarnessOptions = {}
): Promise<boolean> {
  try {
    await callNative("Devtools", "enableAxonMetricsHarness", options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Disables the native Axon metrics harness.
 */
export async function disableAxonMetricsHarness(): Promise<boolean> {
  try {
    await callNative("Devtools", "disableAxonMetricsHarness", {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Controls whether Axon text measurement uses the Java probe or a native fallback estimator.
 */
export async function setAxonTextMeasureMode(
  mode: AxonTextMeasureMode
): Promise<boolean> {
  try {
    await callNative("Devtools", "setAxonTextMeasureMode", { mode });
    return true;
  } catch {
    return false;
  }
}

export const PerformanceOverlay = {
  setEnabled: setPerformanceOverlayEnabled,
  getStats: getPerformanceOverlayStats,
  enableAxonMetricsHarness,
  disableAxonMetricsHarness,
  setAxonTextMeasureMode,
};
