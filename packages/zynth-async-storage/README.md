# Async Storage

An asynchronous, unencrypted, persistent, key-value storage system for Zynth applications.

`@zynth/async-storage` provides a simple way to persist data across application restarts. It leverages the native key-value storage systems of each platform: **UserDefaults** on iOS and **SharedPreferences** on Android.

## Basic usage

### Storing and Retrieving Data

All operations in `AsyncStorage` are asynchronous and return a `Promise`. While callbacks are supported for legacy compatibility, using `async/await` is recommended.

```tsx
import { AsyncStorage } from "@zynth/async-storage";

// Storing data
const storeData = async (value: string) => {
  try {
    await AsyncStorage.setItem("user_name", value);
  } catch (e) {
    // saving error
  }
};

// Retrieving data
const getData = async () => {
  try {
    const value = await AsyncStorage.getItem("user_name");
    if (value !== null) {
      console.log("Retrieved:", value);
    }
  } catch (e) {
    // error reading value
  }
};
```

### Using Key Accessors

If you frequently access the same key, you can use `useAsyncStorage` to create a scoped accessor.

```tsx
import { useAsyncStorage } from "@zynth/async-storage";

const { getItem, setItem } = useAsyncStorage("settings_theme");

const toggleTheme = async () => {
  const current = await getItem();
  await setItem(current === "dark" ? "light" : "dark");
};
```

## Advanced

### Reactive Storage Signals

Zynth integrates `AsyncStorage` directly with SolidJS reactivity via `createAsyncStorageSignal`. This automatically synchronizes a signal's value with a persistent storage key.

```tsx
import { createAsyncStorageSignal } from "@zynth/async-storage";

function Settings() {
  const storage = createAsyncStorageSignal("app_theme", {
    initialValue: "light",
    serialize: (v) => v,
    deserialize: (v) => v ?? "light"
  });

  return (
    <IconButton 
      icon={storage.value() === "dark" ? "sun" : "moon"}
      onPress={() => storage.setValue(storage.value() === "dark" ? "light" : "dark")}
      loading={storage.loading()}
    />
  );
}
```

### Batch Operations

For updating multiple keys simultaneously (e.g., during a sync process), use the `multi` methods to reduce bridge overhead.

```ts
await AsyncStorage.multiSet([
  ["key1", "value1"],
  ["key2", "value2"]
]);

const entries = await AsyncStorage.multiGet(["key1", "key2"]);
// [["key1", "value1"], ["key2", "value2"]]
```

## Special cases

- **String-Only Storage**: `AsyncStorage` natively only stores strings. For complex objects, you must use `JSON.stringify` before storing and `JSON.parse` after retrieving. The `createAsyncStorageSignal` utility handles this automatically by default.
- **Merge Operations**: The `mergeItem` method allows you to deep-merge a new JSON structure into an existing one without reading it first.
- **Native Implementation**:
  - **iOS**: Data is persisted in `UserDefaults` using a `zynth.asyncstorage.` internal prefix.
  - **Android**: Data is persisted in `SharedPreferences` within the application's private storage.
- **Native Fallback**: If the native storage module is missing or the bridge is not initialized, the library falls back to a volatile in-memory store. Note that data in this store will not persist across application restarts.

## API Reference

### `AsyncStorage` Methods

- `getItem(key: string): Promise<string | null>`
- `setItem(key: string, value: string): Promise<void>`
- `removeItem(key: string): Promise<void>`
- `mergeItem(key: string, value: string): Promise<void>`
- `clear(): Promise<void>`
- `getAllKeys(): Promise<string[]>`
- `multiGet(keys: string[]): Promise<[string, string | null][]>`
- `multiSet(pairs: [string, string][]): Promise<void>`
- `multiRemove(keys: string[]): Promise<void>`

### `createAsyncStorageSignal<T>(key, options)`
- **Options**:
  - `initialValue: T`
  - `serialize?: (value: T) => string`
  - `deserialize?: (value: string | null) => T`
- **Returns**:
  - `value: Accessor<T>`
  - `loading: Accessor<boolean>`
  - `error: Accessor<Error | null>`
  - `setValue: (next: T) => Promise<void>`
  - `remove: () => Promise<void>`
  - `refresh: () => Promise<void>`
