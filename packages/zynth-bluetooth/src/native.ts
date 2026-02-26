import {
  callNative as coreCallNative,
  callNativeSync as coreCallNativeSync,
  getGlobalObject,
  getModulesBridge,
} from "@zynth/core";
import type {
  BluetoothBleEvent,
  BluetoothClassicEvent,
  BluetoothErrorCode,
  BluetoothOperationError,
  BluetoothOperationResult,
  NativeEventSubscription,
} from "./types";

const MODULE_NAME = "Bluetooth";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";

interface NativeEmitterBridge {
  addListener(eventName: string, callback: (payload: unknown) => void): NativeEventSubscription;
}

function getPlatform(): string | null {
  const globalObj = getGlobalObject() as Record<string, unknown>;
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function createMissingModuleError(): Error {
  return new Error(
    `[${MODULE_NAME}] Native module not found. Ensure @zynth/bluetooth is installed and native projects are regenerated.`
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function createOperationError(
  code: BluetoothErrorCode,
  message: string,
  details?: Record<string, unknown>
): BluetoothOperationError {
  const error = new Error(`[${MODULE_NAME}] ${message}`) as BluetoothOperationError;
  error.code = code;
  error.details = details;
  return error;
}

export function normalizeOperation<T>(
  value: unknown,
  fallbackMessage: string
): T {
  const record = asRecord(value);
  if (!record) {
    return value as T;
  }

  if (record.ok === false) {
    const code =
      typeof record.code === "string"
        ? (record.code as BluetoothErrorCode)
        : "E_NATIVE";
    const message =
      typeof record.message === "string" ? record.message : fallbackMessage;
    throw createOperationError(code, message, record);
  }

  const data = record.data;
  if (typeof data === "undefined") {
    return value as T;
  }
  return data as T;
}

export async function callNative<T>(method: string, args?: unknown): Promise<T> {
  try {
    const result = await coreCallNative<unknown>(MODULE_NAME, method, args);
    return normalizeOperation<T>(result, `${method} failed`);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message.includes("module_not_found") || error.message.includes("not found"))
    ) {
      throw createMissingModuleError();
    }
    throw error;
  }
}

export function callNativeSync<T>(method: string, args?: unknown): T {
  try {
    const result = coreCallNativeSync<unknown>(MODULE_NAME, method, args);
    return normalizeOperation<T>(result, `${method} failed`);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message.includes("module_not_found") || error.message.includes("not found"))
    ) {
      throw createMissingModuleError();
    }
    throw error;
  }
}

export function isNativeAvailable(): boolean {
  const platform = getPlatform();
  if (platform !== "ios" && platform !== "android") {
    return false;
  }
  const bridge = getModulesBridge();
  return Boolean(bridge?.call || bridge?.callSync);
}

function getNativeEmitter(): NativeEmitterBridge | null {
  const globalObj = getGlobalObject() as { ZynthNativeEmitter?: unknown };
  const emitter = globalObj.ZynthNativeEmitter;
  if (!emitter || typeof emitter !== "object") {
    return null;
  }
  const candidate = emitter as Partial<NativeEmitterBridge>;
  if (typeof candidate.addListener !== "function") {
    return null;
  }
  return candidate as NativeEmitterBridge;
}

function subscribeEvent<T>(
  eventName: string,
  listener: (event: T) => void
): NativeEventSubscription {
  const emitter = getNativeEmitter();
  if (!emitter) {
    return { remove() {} };
  }
  return emitter.addListener(eventName, (payload: unknown) => {
    listener(payload as T);
  });
}

export function subscribeClassicEvent(
  listener: (event: BluetoothClassicEvent) => void
): NativeEventSubscription {
  return subscribeEvent<BluetoothClassicEvent>("Bluetooth.classicEvent", listener);
}

export function subscribeBleEvent(
  listener: (event: BluetoothBleEvent) => void
): NativeEventSubscription {
  return subscribeEvent<BluetoothBleEvent>("Bluetooth.bleEvent", listener);
}

export async function requestPermissionsWithEvent(
  requestId: string,
  transport: "classic" | "ble" | "all"
): Promise<BluetoothOperationResult<Record<string, unknown>>> {
  const emitter = getNativeEmitter();
  if (!emitter) {
    throw createOperationError("E_UNAVAILABLE", "Native event emitter unavailable");
  }

  return new Promise<BluetoothOperationResult<Record<string, unknown>>>((resolve, reject) => {
    const subscription = emitter.addListener("Bluetooth.permissionResult", (payload: unknown) => {
      const record = asRecord(payload);
      if (!record || record.requestId !== requestId) {
        return;
      }
      subscription.remove();
      const ok = record.ok === true;
      const result: BluetoothOperationResult<Record<string, unknown>> = {
        ok,
        code: typeof record.code === "string" ? (record.code as BluetoothErrorCode) : undefined,
        message: typeof record.message === "string" ? record.message : undefined,
        data: asRecord(record.data) ?? undefined,
      };
      resolve(result);
    });

    void callNative<unknown>("requestPermissions", {
      requestId,
      transport,
    }).catch((error: unknown) => {
      subscription.remove();
      reject(error);
    });
  });
}
