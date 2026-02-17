import type { ZynthNativeEmitterBridge } from "./nativeEmitter";

export type ZynthUIBridge = {
  createNode(type: string): number;
  setProp(id: number, name: string, value: any): void;
  setText(id: number, text: string): void;
  insertChild(parent: number, child: number, index: number): void;
  removeChild(parent: number, child: number): void;
  setHandler(id: number, name: string, fn: Function): void;
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
  var __zynth_ui_commands: ZynthUICommandsBridge;
  var NativeConstants: Record<string, any>;
}

let _nextNonce = Date.now();

/**
 * Retrieves the global object in a cross-platform safe way.
 */
export function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof global !== "undefined") return global;
  if (typeof window !== "undefined") return window;
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
      throw new Error(value.message || value.error || "Unknown native error");
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