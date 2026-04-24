# Platform

The default platform surface in Zynth is `platform`, which provides high-level detection and conditional branching for code bases targeting multiple operating systems.

It abstracts the underlying environment variables and provides a stable, type-safe interface for platform-specific logic, styling, and performance logging.

## Basic usage

### OS Detection

The simplest way to check the current platform is through `platform.current`.

```tsx
import { platform } from "@zynthjs/apis";

if (platform.current === "ios") {
  // iPhone/iPad specific logic
} else if (platform.current === "android") {
  // Android specific logic
}
```

### Platform-Specific Values

The `platform.choose()` method is a declarative utility that returns the matching value for the current platform.

```tsx
import { platform } from "@zynthjs/apis";

const containerStyle = {
  flex: 1,
  paddingTop: platform.choose({
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
import { platform } from "@zynthjs/apis";

// Log native frame timings and operation queue sizes
platform.logPerformanceStats();
```

## Special cases

- **Web Fallback**: When running in a browser environment without the Zynth JSI bridge, `Platform.OS` correctly resolves to `"web"`.

## API Reference

### `platform.current`
The current operating system identifier: `"ios" | "android" | "web"`.

### `platform.choose<T>(spec: PlatformSelectSpec<T>): T`
Selects an entry from the provided specification.
- **Spec**: `{ ios?, android?, web?, default? }`
- **Throws**: An error if no platform match is found and no `default` is provided.

### `platform.is(target): boolean`
Convenience helper for direct platform comparisons.

### `platform.logPerformanceStats(): void`
Utility to trigger a native performance dump to the console (Android only).

### Legacy compatibility

`Platform`, `OS`, and `Platform.select()` remain exported for compatibility with existing code and generated snippets.
