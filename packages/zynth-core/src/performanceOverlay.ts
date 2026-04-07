import { callNative } from "./bridge";

export type PerformanceOverlayStats = {
  /** Whether the native overlay is currently mounted. */
  enabled: boolean;
  /** Current process resident memory in megabytes. */
  ramMb: number;
  /** Number of native views under the active root. */
  views: number;
  /** Smoothed UI display-link FPS. */
  uiFps: number;
  /** Smoothed JS ping FPS. */
  jsFps: number;
  /** Most recent Zynth UI manager frame pass duration in milliseconds. */
  lastPassMs: number;
  /** Shortest recorded Zynth UI manager frame pass duration in milliseconds. */
  shortestPassMs: number;
  /** Longest recorded Zynth UI manager frame pass duration in milliseconds. */
  longestPassMs: number;
  /** Count of recorded Zynth UI manager frame passes that exceeded budget. */
  budgetOverruns: number;
  /** Count of Zynth UI manager frame passes recorded while the overlay is enabled. */
  totalPasses: number;
};

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
  const asDuration = (entry: unknown): number => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return 0;
    }
    return Math.max(0, entry);
  };
  return {
    enabled: Boolean(record.enabled),
    ramMb: asNumber(record.ramMb),
    views: asNumber(record.views),
    uiFps: asNumber(record.uiFps),
    jsFps: asNumber(record.jsFps),
    lastPassMs: asDuration(record.lastPassMs),
    shortestPassMs: asDuration(record.shortestPassMs),
    longestPassMs: asDuration(record.longestPassMs),
    budgetOverruns: asNumber(record.budgetOverruns),
    totalPasses: asNumber(record.totalPasses),
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

export const PerformanceOverlay = {
  setEnabled: setPerformanceOverlayEnabled,
  getStats: getPerformanceOverlayStats,
};
