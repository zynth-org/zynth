export type AsyncStorageKey = string;

export type AsyncStorageValue = string | null;

export type AsyncStoragePair = readonly [string, string];

export type AsyncStorageEntry = readonly [string, string | null];

export type AsyncStorageCallback<T> = (error: Error | null, result?: T) => void;

export type AsyncStorageMethods = {
  getItem(
    key: AsyncStorageKey,
    callback?: AsyncStorageCallback<AsyncStorageValue>
  ): Promise<AsyncStorageValue>;
  setItem(
    key: AsyncStorageKey,
    value: string,
    callback?: AsyncStorageCallback<void>
  ): Promise<void>;
  removeItem(
    key: AsyncStorageKey,
    callback?: AsyncStorageCallback<void>
  ): Promise<void>;
  mergeItem(
    key: AsyncStorageKey,
    value: string,
    callback?: AsyncStorageCallback<void>
  ): Promise<void>;
  clear(callback?: AsyncStorageCallback<void>): Promise<void>;
  getAllKeys(
    callback?: AsyncStorageCallback<AsyncStorageKey[]>
  ): Promise<AsyncStorageKey[]>;
  multiGet(
    keys: readonly AsyncStorageKey[],
    callback?: AsyncStorageCallback<AsyncStorageEntry[]>
  ): Promise<AsyncStorageEntry[]>;
  multiSet(
    keyValuePairs: readonly AsyncStoragePair[],
    callback?: AsyncStorageCallback<void>
  ): Promise<void>;
  multiRemove(
    keys: readonly AsyncStorageKey[],
    callback?: AsyncStorageCallback<void>
  ): Promise<void>;
  multiMerge(
    keyValuePairs: readonly AsyncStoragePair[],
    callback?: AsyncStorageCallback<void>
  ): Promise<void>;
};

export type AsyncStorageKeyAccessors = {
  getItem(callback?: AsyncStorageCallback<AsyncStorageValue>): Promise<AsyncStorageValue>;
  setItem(value: string, callback?: AsyncStorageCallback<void>): Promise<void>;
  removeItem(callback?: AsyncStorageCallback<void>): Promise<void>;
  mergeItem(value: string, callback?: AsyncStorageCallback<void>): Promise<void>;
};

export type AsyncStorageSignalOptions<T> = {
  initialValue: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string | null) => T;
};

export type AsyncStorageSignal<T> = {
  value: () => T;
  loading: () => boolean;
  error: () => Error | null;
  refresh: () => Promise<void>;
  setValue: (nextValue: T) => Promise<void>;
  remove: () => Promise<void>;
};
