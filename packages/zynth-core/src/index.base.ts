import "./polyfills/URLSearchParams";
import "./polyfills/URL";
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
export { URL } from "./polyfills/URL";
export { TextEncoder, TextDecoder } from "./polyfills/TextEncoding";
export { AbortController, AbortSignal } from "./polyfills/AbortController";
export { ReadableStream } from "./polyfills/ReadableStream";
export { Blob } from "./polyfills/Blob";
export { FormData } from "./polyfills/FormData";
export { fetch, Headers, Request, Response } from "./polyfills/fetch";
export * from "./hmr";
export { setActiveSurface, getActiveSurface } from "./surface";
export { ensureDevtoolsBridge, emitDevtoolsEvent, addDevtoolsListener } from "./devtools";
export { registerWebAdapter } from "./webRegistry";
export { createSharedSignal, captureSharedSignals, readSharedSignal } from "./sharedSignal";
export type { SharedSignalAccessor, SharedSignalToken } from "./sharedSignal";
export { toSharedScalar, interpolateShared } from "./sharedScalar";
export type {
  SharedScalarRef,
  SharedScalarValue,
  InterpolatedScalarRef,
  SharedScalarExtrapolation,
} from "./sharedScalar";
export { createWorklet } from "./worklet";
export type { WorkletFunction, WorkletMetadata, WorkletPayload } from "./worklet";
export { shareSignalRef, isSignalRef, getSignalRefId } from "./signalRef";
export type { SignalRef, SignalRefKind } from "./signalRef";
export {
  createSignalRuntime,
  getRuntimeKind,
  isWorklet,
  scheduleOnUI,
  scheduleOnUIAfter,
} from "./nativeRuntime";
export type { SignalRuntime, SignalRuntimeKind } from "./nativeRuntime";
// Re-export select core helpers so Babel can import from @zynth/core when targeting universal
export { createComponent, mergeProps, untrack } from "solid-js";

// Export image types for use in type declarations
export type { ImageAssetDescriptor } from "./host/HostTypes";

export {
  getGlobalObject,
  getModulesBridge,
  getNativeModule,
  unwrapNativeResult,
  callNative,
  callNativeSync,
} from "./bridge";

export type {
  ZynthUIBridge,
  ZynthModulesBridge,
  ZynthSharedSignalsBridge,
  ZynthWorkletsBridge,
  ZynthUICommandsBridge,
} from "./bridge";
