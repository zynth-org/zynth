# @rune/android (RuneKit)

The native Android runtime for the Rune framework.

This package provides the host environment for executing SolidJS applications on Android. It leverages Hermes, JSI, and Yoga to deliver high-performance native UI rendering.

## Architecture

### 1. JavaScript Runtime (Hermes)
Rune uses [Hermes](https://hermesengine.dev/) as its JavaScript engine.
*   **Bytecode Precompilation**: JS bundles are compiled to bytecode at build time for faster startup.
*   **JSI (JavaScript Interface)**: Used for direct, synchronous communication between C++ and JavaScript, bypassing the traditional React Native asynchronous bridge.

### 2. Layout Engine (Yoga)
Layout is handled by [Yoga](https://yogalayout.dev/), a cross-platform Flexbox implementation written in C++. Rune maps SolidJS style props directly to Yoga nodes.

### 3. RuneRuntime
The core entry point (`com.rune.kit.runtime.RuneRuntime`) manages the application lifecycle:
*   Initializes the Hermes VM.
*   Installs JSI bindings (`__ui` global).
*   Manages the root view hierarchy.

## Key Components

*   **`RuneRuntime`**: Orchestrates the VM, Module Registry, and View Manager.
*   **`RuneBridge` / `JSBridge`**: Handles JSI calls from JavaScript (`createNode`, `setProp`, `callModule`).
*   **`RuneNativeView`**: The base class for all native UI components.

## Native Modules
Native functionality is exposed via the `RuneModule` interface. Modules are registered in the `RuneModuleRegistry` and accessed in JS via `global.__modules`.