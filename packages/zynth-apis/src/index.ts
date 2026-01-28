import { OS, Platform } from "./platform";
import { Dimensions } from "./dimensions";
import { Font } from "./font";
import { Glyphs } from "./glyphs";

export { OS, Platform, Dimensions, Font, Glyphs };
export type { PlatformSelectSpec } from "./platform";
export type {
  DimensionMetrics,
  DimensionsSnapshot,
  DimensionsUpdateMeta,
  DimensionsUpdateSource,
  DimensionsListener,
} from "./dimensions";

export * from "./safe-area";
