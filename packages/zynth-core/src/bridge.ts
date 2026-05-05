import type { ZynthNativeEmitterBridge } from "./nativeEmitter";

export type ZynthUIBridge = {
  createNode(type: string, hasMeasure?: boolean): number;
  setProp(id: number, name: string, value: any): void;
  setText(id: number, text: string): void;
  insertChild(parent: number, child: number, index: number): void;
  removeChild(parent: number, child: number): void;
  setHandler(id: number, name: string, fn: Function): void;
  clearInputHandler?(id: number): void;
  flush(): void;
  applyBatch?(payload: string | Record<string, any>): void;
  setSurface?(surfaceId: number): void;
};

export type ZynthModulesBridge = {
  call(name: string, method: string, args: any): any;
  callSync?: (name: string, method: string, args: any) => any;
};

export type ZynthSharedSignalsBridge = {
  createSharedSignal?: (initialValue: number) => number;
  getSharedSignal?: (id: number) => number;
  setSharedSignal?: (id: number, value: number) => void;
  removeSharedSignal?: (id: number) => void;
  createSharedValue?: (initialValue: number) => number;
  getSharedValue?: (id: number) => number;
  setSharedValue?: (id: number, value: number) => void;
  cancelSharedValue?: (id: number) => void;
};

export type ZynthWorkletsBridge = {
  register: (payload: {
    code: string;
    location?: string;
    closure?: Record<string, unknown>;
  }) => number;
  run?: (id: number) => void;
  runAfter?: (id: number, delayMs: number) => void;
};

export type ZynthSyncSignalsBridge = {
  createSyncSignal?: (initialValue: string) => number;
  getSyncSignal?: (id: number) => string;
  setSyncSignal?: (id: number, value: string) => void;
  removeSyncSignal?: (id: number) => void;
};

export type ZynthUICommandsBridge = {
  scrollTo: (nodeId: number, x?: number, y?: number, animated?: boolean) => void;
};

declare global {
  var __ui: ZynthUIBridge;
  var __modules: ZynthModulesBridge;
  var __startApp: (rootId: number) => void;
  var ZynthNativeEmitter: ZynthNativeEmitterBridge;
  var __zynth_shared_signals: ZynthSharedSignalsBridge;
  var __zynth_worklets: ZynthWorkletsBridge;
  var __zynth_sync_signals: ZynthSyncSignalsBridge;
  var __zynth_ui_commands: ZynthUICommandsBridge;
  /** JSI HostObject injected by the native animation runtime (ZynthAnimateJSI). */
  var __zynth_animate: ZynthAnimateJSIBridge | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var NativeConstants: Record<string, any>;
}

/**
 * Shape of the native animation JSI HostObject (`__zynth_animate`).
 * Exposed globally by the iOS/Android ZynthAnimateJSI native module.
 */
export type ZynthAnimateJSIBridge = {
  createSharedValue: (initialValue: number) => number;
  getSharedValue: (id: number) => number;
  setSharedValue: (id: number, value: number) => void;
  animateSharedValue: (id: number, config: Record<string, unknown>) => void;
  cancelSharedValue: (id: number) => void;
  consumeAnimationCompletions: () => Array<{ callbackId: number; finished: boolean }>;
  createStyleMapper: (nodeId: number, style: Record<string, unknown>) => number;
  updateStyleMapper: (mapperId: number, style: Record<string, unknown>) => void;
  removeStyleMapper: (mapperId: number) => void;
};

let _nextNonce = Date.now();

type NativeErrorResult = {
  error?: unknown;
  message?: unknown;
  details?: unknown;
};

type ZynthNativeError = Error & {
  code?: string;
  details?: unknown;
};

/**
 * Retrieves the global object in a cross-platform safe way.
 */
export function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  try {
    return Function("return this")();
  } catch {
    return {};
  }
}

function getSessionId(): string | undefined {
  const g = getGlobalObject();
  return g.NativeConstants?.bridgeSessionId;
}

/**
 * Access the Zynth Modules Bridge.
 */
export function getModulesBridge(): ZynthModulesBridge | null {
  const g = getGlobalObject();
  return g.__modules || null;
}

/**
 * Access a specific JSI Native Module.
 */
export function getNativeModule<T>(key: string): T | null {
  const g = getGlobalObject();
  return (g[key] as T) || null;
}

/**
 * Unwraps the result from a native call.
 */
export function unwrapNativeResult<T = unknown>(value: any): T {
  if (value && typeof value === "object") {
    if ("error" in value) {
      const nativeError = value as NativeErrorResult;
      const code = typeof nativeError.error === "string" ? nativeError.error : undefined;
      const baseMessage =
        typeof nativeError.message === "string"
          ? nativeError.message
          : typeof nativeError.error === "string"
            ? nativeError.error
            : "Unknown native error";
      const details = nativeError.details;
      const detailsText =
        typeof details === "string"
          ? details.trim()
          : details != null
            ? String(details)
            : "";
      const fullMessage = detailsText.length > 0 ? `${baseMessage}\n${detailsText}` : baseMessage;

      const error = new Error(fullMessage) as ZynthNativeError;
      if (code) {
        error.code = code;
      }
      if (details !== undefined) {
        error.details = details;
      }
      throw error;
    }
    if ("result" in value) return value.result as T;
    if ("data" in value) return value.data as T;
  }
  return value as T;
}

/**
 * Asynchronously call a native module method with automatic security context.
 */
export async function callNative<T = unknown>(
  moduleName: string,
  method: string,
  args?: any
): Promise<T> {
  const bridge = getModulesBridge();
  if (!bridge) {
    throw new Error(`[Zynth] Native bridge not found. Cannot call ${moduleName}.${method}`);
  }

  const sessionId = getSessionId();
  let callArgs = args;

  if (sessionId) {
    if (!args || (typeof args === "object" && !Array.isArray(args))) {
      callArgs = {
        ...(args || {}),
        bridgeSessionId: sessionId,
        nonce: ++_nextNonce,
      };
    }
  }

  const result = await Promise.resolve(bridge.call(moduleName, method, callArgs));
  return unwrapNativeResult<T>(result);
}

/**
 * Synchronously call a native module method with automatic security context.
 */
export function callNativeSync<T = unknown>(
  moduleName: string,
  method: string,
  args?: any
): T {
  const bridge = getModulesBridge();
  if (!bridge || !bridge.callSync) {
    throw new Error(`[Zynth] Native bridge (callSync) not found. Cannot call ${moduleName}.${method}`);
  }

  const sessionId = getSessionId();
  let callArgs = args;

  if (sessionId) {
    if (!args || (typeof args === "object" && !Array.isArray(args))) {
      callArgs = {
        ...(args || {}),
        bridgeSessionId: sessionId,
        nonce: ++_nextNonce,
      };
    }
  }

  const result = bridge.callSync(moduleName, method, callArgs);
  return unwrapNativeResult<T>(result);
}
