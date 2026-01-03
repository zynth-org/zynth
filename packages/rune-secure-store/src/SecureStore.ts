import type { SecureStoreMethods, SecureStoreOptions } from "./types";
import { buildArgs, callNative, callNativeSync, isNativeAvailable } from "./native";

function assertKey(key: unknown): string {
  if (typeof key !== "string" || !key.length) {
    throw new TypeError("SecureStore key must be a non-empty string");
  }
  return key;
}

function assertValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("SecureStore value must be a string");
  }
  return value;
}

async function ensureAvailable(): Promise<void> {
  if (!isNativeAvailable()) {
    throw new Error("SecureStore is not available on this platform");
  }
}

const SecureStore: SecureStoreMethods = {
  async getItemAsync(key, options) {
    const safeKey = assertKey(key);
    await ensureAvailable();
    return callNative<string | null>("getItem", buildArgs(safeKey, options));
  },
  async setItemAsync(key, value, options) {
    const safeKey = assertKey(key);
    const safeValue = assertValue(value);
    await ensureAvailable();
    await callNative<void>("setItem", buildArgs(safeKey, options, safeValue));
  },
  async deleteItemAsync(key, options) {
    const safeKey = assertKey(key);
    await ensureAvailable();
    await callNative<void>("deleteItem", buildArgs(safeKey, options));
  },
  getItem(key, options) {
    const safeKey = assertKey(key);
    if (!isNativeAvailable()) {
      throw new Error("SecureStore is not available on this platform");
    }
    return callNativeSync<string | null>("getItem", buildArgs(safeKey, options));
  },
  setItem(key, value, options) {
    const safeKey = assertKey(key);
    const safeValue = assertValue(value);
    if (!isNativeAvailable()) {
      throw new Error("SecureStore is not available on this platform");
    }
    callNativeSync<void>("setItem", buildArgs(safeKey, options, safeValue));
  },
  deleteItem(key, options) {
    const safeKey = assertKey(key);
    if (!isNativeAvailable()) {
      throw new Error("SecureStore is not available on this platform");
    }
    callNativeSync<void>("deleteItem", buildArgs(safeKey, options));
  },
  async isAvailableAsync() {
    if (!isNativeAvailable()) {
      return false;
    }
    try {
      return await callNative<boolean>("isAvailable", {});
    } catch {
      return false;
    }
  },
  async canUseBiometricAuthentication() {
    if (!isNativeAvailable()) {
      return false;
    }
    try {
      return await callNative<boolean>("canUseBiometricAuthentication", {});
    } catch {
      return false;
    }
  },
};

export { SecureStore };
export type { SecureStoreOptions };
