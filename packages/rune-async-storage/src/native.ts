import type { AsyncStorageEntry, AsyncStoragePair } from "./types";

type ModulesBridge = {
  call?(name: string, method: string, args?: unknown): Promise<unknown> | unknown;
  callSync?(name: string, method: string, args?: unknown): unknown;
};

type ErrorResult = {
  error?: string;
  message?: string;
  code?: string;
};

type NativeAsyncStorageJSI = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  mergeItem?(key: string, value: string): void;
  clear(): void;
  getAllKeys(): string[];
  multiGet(keys: readonly string[]): AsyncStorageEntry[];
  multiSet(pairs: readonly AsyncStoragePair[]): void;
  multiRemove(keys: readonly string[]): void;
  multiMerge?(pairs: readonly AsyncStoragePair[]): void;
};

type StorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  mergeItem(key: string, value: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<string[]>;
  multiGet(keys: readonly string[]): Promise<AsyncStorageEntry[]>;
  multiSet(pairs: readonly AsyncStoragePair[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  multiMerge(pairs: readonly AsyncStoragePair[]): Promise<void>;
};

const MODULE_NAME = "RuneAsyncStorage";
const JSI_GLOBAL_KEY = "__rune_async_storage";
const PLATFORM_GLOBAL_KEY = "__RUNE_PLATFORM";
const memoryStore = new Map<string, string>();
let warnedMissing = false;

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as Record<string, unknown>;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function getPlatform(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = (globalObj as { __modules?: unknown }).__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

function getNativeJSI(): NativeAsyncStorageJSI | null {
  const globalObj = getGlobalObject();
  const native = globalObj[JSI_GLOBAL_KEY];
  if (!native || typeof native !== "object") {
    return null;
  }
  return native as NativeAsyncStorageJSI;
}

function warnMissingNativeOnce(): void {
  if (warnedMissing) return;
  const platform = getPlatform();
  if (platform === "ios" || platform === "android") {
    warnedMissing = true;
    console.warn(
      "[RuneAsyncStorage] Native module not found; using in-memory fallback."
    );
  }
}

function isErrorResult(value: unknown): value is ErrorResult {
  if (!value || typeof value !== "object") return false;
  return typeof (value as ErrorResult).error === "string";
}

function unwrapResult<T>(value: unknown): T {
  if (isErrorResult(value)) {
    const message = value.message || value.error || "Unknown error";
    throw new Error(message);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) {
      return record.result as T;
    }
    if ("data" in record) {
      return record.data as T;
    }
  }
  return value as T;
}

function normalizeItemValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeEntries(value: unknown, keys: readonly string[]): AsyncStorageEntry[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (Array.isArray(entry)) {
        const key = String(entry[0] ?? keys[index] ?? "");
        const item = normalizeItemValue(entry[1]);
        return [key, item] as const;
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const key = String(record.key ?? keys[index] ?? "");
        const item = normalizeItemValue(record.value ?? record.item);
        return [key, item] as const;
      }
      const fallbackKey = String(keys[index] ?? "");
      return [fallbackKey, null] as const;
    });
  }

  return keys.map((key) => [key, null] as const);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepMerge(
  base: Record<string, unknown>,
  update: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(update)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function mergeJsonStrings(existing: string | null, incoming: string): string {
  if (existing == null) return incoming;
  try {
    const base = JSON.parse(existing);
    const update = JSON.parse(incoming);
    if (isPlainObject(base) && isPlainObject(update)) {
      return JSON.stringify(deepMerge(base, update));
    }
  } catch {
    return incoming;
  }
  return incoming;
}

function createMemoryAdapter(): StorageAdapter {
  return {
    async getItem(key) {
      return memoryStore.has(key) ? memoryStore.get(key) ?? null : null;
    },
    async setItem(key, value) {
      memoryStore.set(key, value);
    },
    async removeItem(key) {
      memoryStore.delete(key);
    },
    async mergeItem(key, value) {
      const current = memoryStore.get(key) ?? null;
      memoryStore.set(key, mergeJsonStrings(current, value));
    },
    async clear() {
      memoryStore.clear();
    },
    async getAllKeys() {
      return Array.from(memoryStore.keys());
    },
    async multiGet(keys) {
      return keys.map((key) => [key, memoryStore.get(key) ?? null] as const);
    },
    async multiSet(pairs) {
      for (const [key, value] of pairs) {
        memoryStore.set(key, value);
      }
    },
    async multiRemove(keys) {
      for (const key of keys) {
        memoryStore.delete(key);
      }
    },
    async multiMerge(pairs) {
      for (const [key, value] of pairs) {
        const current = memoryStore.get(key) ?? null;
        memoryStore.set(key, mergeJsonStrings(current, value));
      }
    },
  };
}

function createJSIAdapter(native: NativeAsyncStorageJSI): StorageAdapter {
  return {
    async getItem(key) {
      return normalizeItemValue(native.getItem(key));
    },
    async setItem(key, value) {
      native.setItem(key, value);
    },
    async removeItem(key) {
      native.removeItem(key);
    },
    async mergeItem(key, value) {
      if (native.mergeItem) {
        native.mergeItem(key, value);
        return;
      }
      const current = normalizeItemValue(native.getItem(key));
      native.setItem(key, mergeJsonStrings(current, value));
    },
    async clear() {
      native.clear();
    },
    async getAllKeys() {
      return native.getAllKeys();
    },
    async multiGet(keys) {
      return normalizeEntries(native.multiGet(keys), keys);
    },
    async multiSet(pairs) {
      native.multiSet(pairs);
    },
    async multiRemove(keys) {
      native.multiRemove(keys);
    },
    async multiMerge(pairs) {
      if (native.multiMerge) {
        native.multiMerge(pairs);
        return;
      }
      for (const [key, value] of pairs) {
        const current = normalizeItemValue(native.getItem(key));
        native.setItem(key, mergeJsonStrings(current, value));
      }
    },
  };
}

function createBridgeAdapter(): StorageAdapter | null {
  const bridge = getModulesBridge();
  if (!bridge || (!bridge.call && !bridge.callSync)) {
    return null;
  }

  const callNative = async <T>(method: string, args?: unknown): Promise<T> => {
    if (bridge.callSync) {
      return unwrapResult<T>(bridge.callSync(MODULE_NAME, method, args));
    }
    if (bridge.call) {
      const result = await Promise.resolve(bridge.call(MODULE_NAME, method, args));
      return unwrapResult<T>(result);
    }
    throw new Error("Native modules bridge not available");
  };

  return {
    async getItem(key) {
      const value = await callNative<unknown>("getItem", { key });
      return normalizeItemValue(value);
    },
    async setItem(key, value) {
      await callNative<void>("setItem", { key, value });
    },
    async removeItem(key) {
      await callNative<void>("removeItem", { key });
    },
    async mergeItem(key, value) {
      await callNative<void>("mergeItem", { key, value });
    },
    async clear() {
      await callNative<void>("clear", {});
    },
    async getAllKeys() {
      const keys = await callNative<unknown>("getAllKeys", {});
      if (Array.isArray(keys)) {
        return keys.map((key) => String(key));
      }
      return [];
    },
    async multiGet(keys) {
      const result = await callNative<unknown>("multiGet", { keys });
      return normalizeEntries(result, keys);
    },
    async multiSet(pairs) {
      await callNative<void>("multiSet", { pairs });
    },
    async multiRemove(keys) {
      await callNative<void>("multiRemove", { keys });
    },
    async multiMerge(pairs) {
      await callNative<void>("multiMerge", { pairs });
    },
  };
}

let cachedAdapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  const jsi = getNativeJSI();
  if (jsi) {
    return createJSIAdapter(jsi);
  }

  const bridgeAdapter = createBridgeAdapter();
  if (bridgeAdapter) {
    cachedAdapter = bridgeAdapter;
    return bridgeAdapter;
  }

  if (!cachedAdapter) {
    warnMissingNativeOnce();
    cachedAdapter = createMemoryAdapter();
  }
  return cachedAdapter;
}

export { mergeJsonStrings };
export type { StorageAdapter };
