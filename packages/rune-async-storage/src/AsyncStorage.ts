import { getStorageAdapter } from "./native";
import type {
  AsyncStorageCallback,
  AsyncStorageEntry,
  AsyncStorageKey,
  AsyncStorageKeyAccessors,
  AsyncStorageMethods,
  AsyncStoragePair,
  AsyncStorageValue,
} from "./types";

function withCallback<T>(
  promise: Promise<T>,
  callback?: AsyncStorageCallback<T>
): Promise<T> {
  if (typeof callback !== "function") {
    return promise;
  }
  promise.then(
    (result) => callback(null, result),
    (error) => callback(error as Error)
  );
  return promise;
}

function assertKey(key: unknown): AsyncStorageKey {
  if (typeof key !== "string") {
    throw new TypeError("AsyncStorage key must be a string");
  }
  return key;
}

function assertValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("AsyncStorage value must be a string");
  }
  return value;
}

function normalizeKeys(keys: readonly AsyncStorageKey[]): AsyncStorageKey[] {
  if (!Array.isArray(keys)) {
    throw new TypeError("AsyncStorage keys must be an array of strings");
  }
  return keys.map((key) => assertKey(key));
}

function normalizePairs(pairs: readonly AsyncStoragePair[]): AsyncStoragePair[] {
  if (!Array.isArray(pairs)) {
    throw new TypeError("AsyncStorage pairs must be an array of [key, value]");
  }
  return pairs.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) {
      throw new TypeError("AsyncStorage pair must be a [key, value] tuple");
    }
    const key = assertKey(pair[0]);
    const value = assertValue(pair[1]);
    return [key, value] as const;
  });
}

const AsyncStorage: AsyncStorageMethods = {
  getItem(key, callback) {
    const safeKey = assertKey(key);
    const promise = getStorageAdapter().getItem(safeKey);
    return withCallback<AsyncStorageValue>(promise, callback);
  },
  setItem(key, value, callback) {
    const safeKey = assertKey(key);
    const safeValue = assertValue(value);
    const promise = getStorageAdapter().setItem(safeKey, safeValue);
    return withCallback<void>(promise, callback);
  },
  removeItem(key, callback) {
    const safeKey = assertKey(key);
    const promise = getStorageAdapter().removeItem(safeKey);
    return withCallback<void>(promise, callback);
  },
  mergeItem(key, value, callback) {
    const safeKey = assertKey(key);
    const safeValue = assertValue(value);
    const promise = getStorageAdapter().mergeItem(safeKey, safeValue);
    return withCallback<void>(promise, callback);
  },
  clear(callback) {
    const promise = getStorageAdapter().clear();
    return withCallback<void>(promise, callback);
  },
  getAllKeys(callback) {
    const promise = getStorageAdapter().getAllKeys();
    return withCallback<AsyncStorageKey[]>(promise, callback);
  },
  multiGet(keys, callback) {
    const safeKeys = normalizeKeys(keys);
    const promise = getStorageAdapter().multiGet(safeKeys);
    return withCallback<AsyncStorageEntry[]>(promise, callback);
  },
  multiSet(pairs, callback) {
    const safePairs = normalizePairs(pairs);
    const promise = getStorageAdapter().multiSet(safePairs);
    return withCallback<void>(promise, callback);
  },
  multiRemove(keys, callback) {
    const safeKeys = normalizeKeys(keys);
    const promise = getStorageAdapter().multiRemove(safeKeys);
    return withCallback<void>(promise, callback);
  },
  multiMerge(pairs, callback) {
    const safePairs = normalizePairs(pairs);
    const promise = getStorageAdapter().multiMerge(safePairs);
    return withCallback<void>(promise, callback);
  },
};

export function createAsyncStorageKey(key: AsyncStorageKey): AsyncStorageKeyAccessors {
  const safeKey = assertKey(key);
  return {
    getItem(callback) {
      return AsyncStorage.getItem(safeKey, callback);
    },
    setItem(value, callback) {
      return AsyncStorage.setItem(safeKey, value, callback);
    },
    removeItem(callback) {
      return AsyncStorage.removeItem(safeKey, callback);
    },
    mergeItem(value, callback) {
      return AsyncStorage.mergeItem(safeKey, value, callback);
    },
  };
}

export const useAsyncStorage = createAsyncStorageKey;

export { AsyncStorage };
