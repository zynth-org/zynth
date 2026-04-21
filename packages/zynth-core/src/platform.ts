export enum OS {
  IOS = "ios",
  ANDROID = "android",
  WEB = "web",
}

const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";
const DEFAULT_OS = OS.WEB;

type PlatformKey = `${OS}`;

type PlatformSelectSpec<T> = Partial<Record<PlatformKey, T>> & {
  default?: T;
};

function resolveOS(): OS {
  if (typeof globalThis === "undefined") {
    return DEFAULT_OS;
  }
  const value = (globalThis as Record<string, unknown>)[PLATFORM_GLOBAL_KEY];
  if (typeof value !== "string") {
    // Check for browser environment
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      return OS.WEB;
    }
    return DEFAULT_OS;
  }
  const normalized = value.toLowerCase();
  if (normalized === OS.ANDROID) return OS.ANDROID;
  if (normalized === OS.IOS) return OS.IOS;
  return DEFAULT_OS;
}

function getSpecValue<T>(spec: PlatformSelectSpec<T>, os: OS): T {
  if (os === OS.ANDROID && spec.android !== undefined) {
    return spec.android;
  }
  if (os === OS.IOS && spec.ios !== undefined) {
    return spec.ios;
  }
  if (os === OS.WEB && spec.web !== undefined) {
    return spec.web;
  }
  if (spec.default !== undefined) {
    return spec.default;
  }
  throw new Error(
    `[Platform.select] No selection found for OS "${os}". Provide a default option.`
  );
}

export const Platform = Object.freeze({
  get OS(): OS {
    return resolveOS();
  },
  get isWeb(): boolean {
    return resolveOS() === OS.WEB;
  },
  select<T>(spec: PlatformSelectSpec<T>): T {
    return getSpecValue(spec, resolveOS());
  },
  /**
   * Log native performance statistics (Android only).
   * Call this after scrolling to see flush times, operation queue sizes, etc.
   */
  logPerformanceStats(): void {
    if (typeof globalThis === "undefined") return;
    const ui = (globalThis as any).__ui;
    if (ui && typeof ui.logPerformanceStats === "function") {
      ui.logPerformanceStats();
    }
  },
});

export type { PlatformSelectSpec };
