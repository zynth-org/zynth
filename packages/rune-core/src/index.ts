import "./polyfills/URLSearchParams";
export * from "./renderer";
export * from "./host/HostTypes";
export { createIOSHost } from "./host/ios";
export { createAndroidHost } from "./host/android";
export * from "./nativeEmitter";
export { start } from "./start";
export * from "./hmr";
export { setActiveSurface, getActiveSurface } from "./surface";
// Re-export select core helpers so Babel can import from @rune/core when targeting universal
export { createComponent, mergeProps, untrack } from "solid-js";

// Export image types for use in type declarations
export type { ImageAssetDescriptor } from "./host/HostTypes";
