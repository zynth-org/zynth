# APIs

The standard library of Zynth APIs, providing essential infrastructure for platform detection, hardware access, and lifecycle management.

`@zynthjs/apis` is a suite of reactive, cross-platform interfaces that bridge the gap between native OS capabilities and JavaScript. It provides stable communication patterns for accessing system state through the Zynth JSI bridge.

The default public surface uses lowercase bindings such as `platform`, `viewport`, `appState`, `connectivity`, and `device`. Legacy namespaces such as `Platform`, `Dimensions`, `AppState`, `Network`, and `Device` remain available for compatibility with existing code patterns and LLM-generated code while the ecosystem learns the newer Zynth style.

## Features

- **Platform Detection**: Branch code based on OS and handle platform-specific values.
- **Display Metrics**: Reactive access to window and screen dimensions with rotation support.
- **Hardware Metadata**: Access to device information including models, identifiers, and hardware features.
- **Dynamic Fonts**: Registration system for fonts that synchronizes with UI rendering.
- **Lifecycle & Safety**: Monitor connectivity, app state transitions, and safe area insets.

## Documentation Index

Explore the specialized technical guides for the Zynth standard API suite:

- **[Platform](./docs/Platform.md)**: OS detection and `platform.choose`.
- **[Dimensions](./docs/Dimensions.md)**: Screen and window metrics through `viewport`.
- **[Device](./docs/Device.md)**: Hardware info and unique identifiers.
- **[AppState](./docs/AppState.md)**: App lifecycle (active/background).
- **[Font](./docs/Font.md)**: Dynamic font loading and registration.
- **[Network](./docs/Network.md)**: Connectivity and reachability status.
- **[SafeArea](./docs/SafeArea.md)**: Notch handling and system insets.

## Getting Started

Most APIs in this package provide reactive state out-of-the-box, though some require setup at the root of your application (like `SafeAreaProvider`).

```tsx
import { SafeAreaProvider, platform } from "@zynthjs/apis";

// APIs are globally available once the framework is initialized
const os = platform.current;

function Root() {
  return (
    <SafeAreaProvider>
       <App />
    </SafeAreaProvider>
  );
}
```
