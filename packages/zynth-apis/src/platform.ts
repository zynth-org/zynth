import { OS, Platform } from "@zynth/core";
import type { PlatformSelectSpec } from "@zynth/core";

export type PlatformValue = `${OS}`;

type PlatformBinding = Readonly<{
  readonly current: PlatformValue;
  choose<T>(spec: PlatformSelectSpec<T>): T;
  is(target: PlatformValue): boolean;
  readonly isNative: boolean;
  logPerformanceStats(): void;
}>;

/**
 * Reactive platform binding for modern Zynth apps.
 * Prefer this over the legacy `Platform` namespace in new code.
 */
export const platform: PlatformBinding = Object.freeze({
  get current(): PlatformValue {
    return Platform.OS;
  },
  choose<T>(spec: PlatformSelectSpec<T>): T {
    return Platform.select(spec);
  },
  is(target: PlatformValue): boolean {
    return Platform.OS === target;
  },
  get isNative(): boolean {
    return Platform.OS !== OS.WEB;
  },
  logPerformanceStats(): void {
    Platform.logPerformanceStats();
  },
});
