import "./polyfills/URLSearchParams";
import "./polyfills/TextEncoding";
import "./polyfills/AbortController";
import "./polyfills/ReadableStream";
import "./polyfills/Blob";
import "./polyfills/FormData";
import "./polyfills/fetch";
export * from "./renderer";
export * from "./host/HostTypes";
export { createIOSHost } from "./host/ios";
export { createAndroidHost } from "./host/android";
export {
  NativeEventEmitter,
  ensureNativeEmitter,
  sharedNativeEventEmitter,
} from "./nativeEmitter";
export { URLSearchParams } from "./polyfills/URLSearchParams";
export { TextEncoder, TextDecoder } from "./polyfills/TextEncoding";
export { AbortController, AbortSignal } from "./polyfills/AbortController";
export { ReadableStream } from "./polyfills/ReadableStream";
export { Blob } from "./polyfills/Blob";
export { FormData } from "./polyfills/FormData";
export { fetch, Headers, Request, Response } from "./polyfills/fetch";
export { start } from "./start";
export * from "./hmr";
export { setActiveSurface, getActiveSurface } from "./surface";
// Re-export select core helpers so Babel can import from @rune/core when targeting universal
export { createComponent, mergeProps, untrack } from "solid-js";

// Export image types for use in type declarations
export type { ImageAssetDescriptor } from "./host/HostTypes";
