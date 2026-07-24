import { createSignal } from "solid-js";
import type { DirectorySignal, DirectorySignalOptions, FileSignal, FileSignalOptions } from "./types";
import { File } from "./File";
import { Directory } from "./Directory";

export function createFileSignal<T>(
  file: File,
  options: FileSignalOptions<T>
): FileSignal<T> {
  const [value, setValue] = createSignal<T>(options.initialValue as any);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);
  const read = options.read ?? (async () => (await file.text()) as unknown as T);
  const write = options.write ?? (async (nextValue) => {
    await file.write(String(nextValue));
  });
  let requestId = 0;

  const refresh = async (): Promise<void> => {
    const currentRequest = ++requestId;
    setLoading(true);
    try {
      const nextValue = await read();
      if (currentRequest !== requestId) return;
      setValue(() => nextValue);
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
      await write(nextValue);
      setValue(() => nextValue);
      setError(null);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await file.delete();
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

export function createDirectorySignal<T = File | Directory>(
  directory: Directory,
  options: DirectorySignalOptions<T> = {}
): DirectorySignal<T> {
  const [entries, setEntries] = createSignal<T[]>(options.initialValue ?? []);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);
  const read = options.read ?? (async () => (await directory.list()) as T[]);
  let requestId = 0;

  const refresh = async (): Promise<void> => {
    const currentRequest = ++requestId;
    setLoading(true);
    try {
      const nextEntries = await read();
      if (currentRequest !== requestId) return;
      setEntries(() => nextEntries);
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

  void refresh();

  return {
    entries,
    loading,
    error,
    refresh,
  };
}
