import { OS, Platform } from "./platform";
import { Dimensions } from "./dimensions";
import { Font } from "./font";
import { Glyphs } from "./glyphs";
import { AppState } from "./app-state";
import { Network } from "./network";
import { Device } from "./device";

export { OS, Platform, Dimensions, Font, Glyphs, AppState, Network, Device };
export type { PlatformSelectSpec } from "./platform";
export type {
  DimensionMetrics,
  DimensionsSnapshot,
  DimensionsUpdateMeta,
  DimensionsUpdateSource,
  DimensionsListener,
} from "./dimensions";
export type { AppStateStatus } from "./app-state";
export type { NetworkState, NetworkType } from "./network";
export type { DeviceInfo, DevicePlatform } from "./device";

export * from "./safe-area";
