# Platform

The `Platform` API provides high-level detection and conditional branching for code bases targeting multiple operating systems within Zynth.

It abstracts the underlying environment variables and provides a stable, type-safe interface for platform-specific logic, styling, and performance logging.

## Basic usage

### OS Detection

The simplest way to check the current platform is through the `Platform.OS` property.

```tsx
import { Platform, OS } from "@zynth/apis";

if (Platform.OS === OS.IOS) {
  // iPhone/iPad specific logic
} else if (Platform.OS === OS.ANDROID) {
  // Android specific logic
}
```

### Platform-Specific Values

The `Platform.select()` method is a declarative utility that returns reaching a specific value based on the current platform.

```tsx
import { Platform } from "@zynth/apis";

const containerStyle = {
  flex: 1,
  paddingTop: Platform.select({
    ios: 44,
    android: 20,
    web: 16,
    default: 0
  })
};
```

## Advanced

### Native Performance Stats

Zynth provides a native-only utility to debug framework performance overhead. This is currently supported only on the Android platform.

```ts
import { Platform } from "@zynth/apis";

// Log native frame timings and operation queue sizes
Platform.logPerformanceStats();
```

## Special cases

- **Web Fallback**: When running in a browser environment without the Zynth JSI bridge, `Platform.OS` correctly resolves to `"web"`.

## API Reference

### `Platform.OS`: `OS`
An immutable property returning the current operating system identifier.
- `OS.IOS`: `"ios"`
- `OS.ANDROID`: `"android"`
- `OS.WEB`: `"web"`

### `Platform.select<T>(spec: PlatformSelectSpec<T>): T`
Selects an entry from the provided specification.
- **Spec**: `{ ios?, android?, web?, default? }`
- **Throws**: An error if no platform match is found and no `default` is provided.

### `Platform.logPerformanceStats(): void`
Utility to trigger a native performance dump to the console (Android only).
