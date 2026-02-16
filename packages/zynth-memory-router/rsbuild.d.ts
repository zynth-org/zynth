import type {
  GeneratedModuleFeature,
  MemoryRouterFileSystemFeatureOptions,
} from "./filesystem-router";

export type { MemoryRouterFileSystemFeatureOptions };

export declare function memoryRouterFileSystem(
  options?: MemoryRouterFileSystemFeatureOptions,
): GeneratedModuleFeature;
