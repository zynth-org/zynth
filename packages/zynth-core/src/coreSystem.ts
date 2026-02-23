import { callNative } from "./bridge";

export type CoreSystemFeature = "startupTime";

export type StartupTimeMetrics = {
  enabled: boolean;
  ready: boolean;
  runtimeInitMs: number | null;
  bundleReadMs: number | null;
  hermesEvalMs: number | null;
  startToFirstFrameMs: number | null;
  runtimeToFirstFrameMs: number | null;
  framesToFirstRender: number;
  avgFrameMsToFirstRender: number | null;
  avgLayoutMsToFirstRender: number | null;
  firstFrameAtMs: number | null;
};

export type CoreSystemMetricsSnapshot = {
  startupTime?: StartupTimeMetrics;
};

function normalizeFeatureName(feature: string): CoreSystemFeature | null {
  if (feature === "startupTime") {
    return feature;
  }
  return null;
}

/**
 * Enables native runtime features for high-performance runtime metrics.
 * This is safe for production and designed to avoid render-loop interference.
 */
export async function enableCoreSystemFeatures(
  features: readonly string[]
): Promise<void> {
  const normalized: CoreSystemFeature[] = [];
  for (let i = 0; i < features.length; i += 1) {
    const feature = normalizeFeatureName(features[i]);
    if (feature && normalized.indexOf(feature) === -1) {
      normalized.push(feature);
    }
  }
  if (normalized.length === 0) {
    return;
  }
  await callNative("CoreSystem", "enableFeatures", {
    features: normalized,
  });
}

/**
 * Returns a full async snapshot of enabled CoreSystem metrics.
 */
export async function getCoreSystemMetrics(): Promise<CoreSystemMetricsSnapshot> {
  return callNative<CoreSystemMetricsSnapshot>("CoreSystem", "getMetrics", {});
}

/**
 * Returns startup metrics if available, otherwise null.
 */
export async function getStartupTimeMetrics(): Promise<StartupTimeMetrics | null> {
  return callNative<StartupTimeMetrics | null>("CoreSystem", "getStartupMetrics", {});
}

/**
 * Convenience API for future runtime-production features.
 */
export const CoreSystem = {
  enableFeatures: enableCoreSystemFeatures,
  getMetrics: getCoreSystemMetrics,
  getStartupMetrics: getStartupTimeMetrics,
};
