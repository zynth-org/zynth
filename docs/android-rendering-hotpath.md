# Android Rendering Hotpath Analysis

This document traces the lifecycle and styling of a `View` component on Android, from its declaration in TypeScript to its native realization.

## 1. Lifecycle of a View (Optimized with C++ Style Engine)

### A. Creation Phase
1.  **TypeScript**: `View.tsx` is invoked. It renders a `<view>` intrinsic.
2.  **Renderer**: The Zynth renderer calls `host.createNode('view', props)`.
3.  **Android Host (`host/android.ts`)**:
    *   Checks for a recycled node in the pool.
    *   If none, calls native `ui.createNode('view')`.
4.  **JSI Bridge (`zynthkit.cpp`)**:
    *   `createNode` invokes `ZynthUIManager.createNode` via JNI to create the Android `View`.
    *   **NEW**: The JSI bridge immediately registers the new `View` and its `nodeId` into the **`ZynthYogaManager` (C++)**. This establishes a direct C++ mapping for future style updates.

### B. Styling & Prop Updates (Direct JSI Injection)
1.  **TypeScript**: `setProperty(node, 'style', nextStyle)` is called.
2.  **Android Host**:
    *   Maps property names to **integer opcodes** (e.g., `width -> 1`, `flex -> 7`).
    *   Enqueues a `setProp` operation.
3.  **Flushing**: `runFlush` encodes the queue into a `TypedBatch`.
4.  **Native Processing (C++ Hotpath)**:
    *   `zynthkit.cpp` receives the `TypedBatch`.
    *   It iterates the batch in C++. If an operation uses a **layout opcode** (1-99), it calls **`ZynthStyleEngine` (C++)** directly.
    *   `ZynthStyleEngine` applies the property to the **`YGNodeRef` (C++ Yoga)**.
    *   **RESULT**: Layout properties bypass Kotlin, JNI, and the Java Yoga wrapper entirely.

## 2. Optimized Architecture

### C++ Style Engine (`ZynthStyleEngine.cpp`)
*   Provides a high-speed mapping from integer opcodes to Yoga C++ API calls (`YGNodeStyleSetWidth`, etc.).
*   Handles unit conversions (pixels, percentages, "auto") in native code.

### C++ Yoga Manager (`ZynthYogaManager.cpp`)
*   Maintains the C++ Yoga tree independently of the Kotlin `ZynthYogaLayout`.
*   Stores global references to Kotlin `View`s for final frame synchronization.

### Layout Syncing
1.  During `flush()`, C++ triggers `YGNodeCalculateLayout`.
2.  Results are collected into a flat `float[]` buffer.
3.  Kotlin's `applyLayoutResults` reads this buffer in a single pass and calls `view.layout(...)` only for views that actually moved.

## 3. Performance Benefits

*   **Zero JNI for Layout Hotpath**: Styling updates for layout no longer cross the JNI boundary during batch processing.
*   **Integer Opcodes**: Eliminates string lookup and hashing overhead in both JS and Native.
*   **Direct Yoga API**: Bypasses the overhead of the Facebook Yoga Java JNI wrapper.
*   **Efficient Batching**: The `TypedBatch` is now partially decoded in C++, leaving only visual/platform properties for Kotlin.

## 4. Summary of Files Involved

| File | Role |
| :--- | :--- |
| `View.tsx` | Entry point, style resolution. |
| `host/android.ts` | **NEW**: Integer-based property mapping and batching. |
| `zynthkit.cpp` | **NEW**: C++ batch decoder and JSI bridge. |
| `ZynthStyleEngine.cpp` | **NEW**: C++ logic for applying styles to Yoga. |
| `ZynthYogaManager.cpp` | **NEW**: C++ Yoga tree management. |
| `ZynthUIManager.kt` | **NEW**: Efficient layout result syncing. |
