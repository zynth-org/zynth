import { createSignal } from "solid-js";
import { AsyncStorage } from "./AsyncStorage";
import type { AsyncStorageSignal, AsyncStorageSignalOptions } from "./types";

function defaultSerialize<T>(value: T): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function defaultDeserialize<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as unknown as T;
  }
}

export function createAsyncStorageSignal<T>(
  key: string,
  options: AsyncStorageSignalOptions<T>
): AsyncStorageSignal<T> {
  const [value, setValue] = createSignal<T>(options.initialValue);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);
  const serialize = options.serialize ?? defaultSerialize;
  const deserialize =
    options.deserialize ??
    ((nextValue: string | null) =>
      defaultDeserialize(nextValue, options.initialValue));
  let requestId = 0;

  const refresh = async (): Promise<void> => {
    const currentRequest = ++requestId;
    setLoading(true);
    try {
      const stored = await AsyncStorage.getItem(key);
      if (currentRequest !== requestId) return;
      setValue(() => deserialize(stored));
      setError(null);
    } catch (err) {
      if (currentRequest === requestId) {
        setError(err as Error);
      }
    } finally {
      if (currentRequest === requestId) {
        setLoading(false);
      }
    }
  };

  const setValueAsync = async (nextValue: T): Promise<void> => {
    try {
      const serialized = serialize(nextValue);
      await AsyncStorage.setItem(key, serialized);
      setValue(() => nextValue);
      setError(null);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem(key);
      setValue(() => options.initialValue);
      setError(null);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  };

  void refresh();

  return {
    value,
    loading,
    error,
    refresh,
    setValue: setValueAsync,
    remove,
  };
}
