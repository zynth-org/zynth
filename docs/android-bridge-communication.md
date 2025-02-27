# Android Bridge Communication: JSI vs Serialized Bridge

## Overview

Rune Framework for Android uses a **hybrid communication architecture** combining JSI (Java/JNI Interface) with Hermes runtime and a fallback serialized bridge. The primary mechanism is **JSI-based**, but includes a serialized JSON fallback for robustness.

## Primary Communication: JSI (Java/JNI Interface)

The framework primarily uses **JSI** to communicate directly with native Android code through Hermes runtime. This is implemented in three main layers:

### 1. Native C++ Layer (`Bridge.cpp`)

- Hermes runtime is instantiated via JNI with `createHermesRuntime()`
- Native bindings are installed using `installBindings()` which registers:
  - `UIShim`: UI operations (createNode, setProp, setText, etc.)
  - `ModulesShim`: Native module invocations
  - `TimerShim`: Timer and animation frame management
  - `ErrorHandler`: JavaScript exception reporting

### 2. Kotlin JNI Bridge (`JSBridge.kt`)

- Defines external JNI methods that interface with C++ code
- Key methods:
  - `evaluateString()` / `evaluateBytecode()`: Execute JavaScript
  - `callGlobal()`: Call global JavaScript functions
  - `invokeHandler()`: Trigger event handlers
  - `onTimerFired()` / `onAnimationFrame()`: Schedule callbacks

### 3. Runtime Adapter (`RuneBridge.kt`)

- Installs global objects (`__ui`, `__modules`) in the JavaScript runtime
- Attempts native bindings first via JNI
- Falls back to Kotlin implementation if native library is unavailable

## Fallback: Serialized JSON Bridge

When native bindings fail (missing native library), the framework automatically falls back to a Kotlin-based serialized bridge:

```kotlin
adapter.setGlobalObject("__ui", mapOf(
  "createNode" to { args -> manager.createNode(...) },
  "setProp" to { args -> manager.setProp(...) },
  // ... other operations
))
```

This fallback:

- Serializes property values to JSON strings
- Uses `Array<Any?>` for function arguments
- Maintains API compatibility with the JSI interface

## Performance Implications for FlatList

### JSI Advantages:

- **Direct native calls** without serialization overhead
- **Type-safe** argument passing
- **Lower latency** for high-frequency operations (ideal for list scrolling)
- **Batch operations** via `applyBatch()` for reducing round-trips

### Serialization Fallback Trade-offs:

- JSON serialization adds CPU overhead
- Suitable for initialization and low-frequency operations
- May impact FlatList performance during rapid scroll events

## Optimization Recommendations

1. **Use Batch Operations**: Group multiple UI operations with `applyBatch()` to reduce JSI call overhead
2. **Minimize Property Changes**: Batch property updates rather than individual `setProp` calls
3. **Leverage JSI**: Ensure native library loads correctly to avoid serialization fallback
4. **Virtual List Optimization**: The framework includes `VirtualListCreator` for efficient list rendering with proper recycling

## Architecture Reference

- **Framework Location**: `packages/rune-android/android/RuneKit/`
- **TypeScript Bindings**: `packages/rune-core/src/bridge.ts`
- **Java Runtime**: `packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/runtime/`
