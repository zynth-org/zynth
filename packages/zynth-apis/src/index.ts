import { OS, Platform } from "@zynth/core";
import type { PlatformSelectSpec } from "@zynth/core";
import { platform } from "./platform";
import { Dimensions, createViewport, viewport } from "./dimensions";
import { Font, createFontLoader } from "./font";
import { Glyphs } from "./glyphs";
import { AppState, appState, createAppState } from "./app-state";
import { Network, connectivity, createConnectivity } from "./network";
import { Device, createDevice, device } from "./device";

export {
  OS,
  Platform,
  platform,
  Dimensions,
  viewport,
  createViewport,
  Font,
  createFontLoader,
  Glyphs,
  AppState,
  appState,
  createAppState,
  Network,
  connectivity,
  createConnectivity,
  Device,
  device,
  createDevice,
};
export type { PlatformSelectSpec };
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
export type { PlatformValue } from "./platform";

export * from "./safe-area";
