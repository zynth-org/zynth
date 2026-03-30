# APIs

The standard library of Zynth APIs, providing essential infrastructure for platform detection, hardware access, and lifecycle management.

`@zynth/apis` is a suite of reactive, cross-platform interfaces that bridge the gap between native OS capabilities and JavaScript. It provides stable communication patterns for accessing system state through the Zynth JSI bridge.

## Features

- **Platform Detection**: Branch code based on OS and handle platform-specific values.
- **Display Metrics**: Reactive access to window and screen dimensions with rotation support.
- **Hardware Metadata**: Access to device information including models, identifiers, and hardware features.
- **Dynamic Fonts**: Registration system for fonts that synchronizes with UI rendering.
- **Lifecycle & Safety**: Monitor connectivity, app state transitions, and safe area insets.

## Documentation Index

Explore the specialized technical guides for the Zynth standard API suite:

- **[Platform](./docs/Platform.md)**: OS detection and `Platform.select`.
- **[Dimensions](./docs/Dimensions.md)**: Screen and window metrics.
- **[Device](./docs/Device.md)**: Hardware info and unique identifiers.
- **[AppState](./docs/AppState.md)**: App lifecycle (active/background).
- **[Font](./docs/Font.md)**: Dynamic font loading and registration.
- **[Network](./docs/Network.md)**: Connectivity and reachability status.
- **[SafeArea](./docs/SafeArea.md)**: Notch handling and system insets.

## Getting Started

Most APIs in this package provide reactive state out-of-the-box, though some require setup at the root of your application (like `SafeAreaProvider`).

```tsx
import { SafeAreaProvider, Platform } from "@zynth/apis";

// APIs are globally available once the framework is initialized
const os = Platform.OS;

function Root() {
  return (
    <SafeAreaProvider>
       <App />
    </SafeAreaProvider>
  );
}
```
