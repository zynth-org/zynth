# Android C++ Rendering (Yoga via JSI)

## Purpose

This document explains the current Android renderer path that moves layout/style hot-path work from Kotlin to C++ (Yoga C API) through JSI.

Goals:

- Keep layout/style mutations in native C++ (low latency, less JNI churn).
- Apply final frames to Android `View`s from C++ layout results.
- Reduce first-frame instability and avoid Kotlin Yoga overriding C++ layout.

---

## High-Level Flow

1. JS host queues typed ops (`setProp`, `insertChild`, `setText`, etc.) in `packages/zynth-core/src/host/android.ts`.
2. `applyBatchTyped(...)` goes into C++ (`packages/zynth-core/android/ZynthKit/src/main/cpp/zynthkit.cpp`).
3. C++ decodes typed ops:
   - Layout props (ids `< 100`) -> `ZynthStyleEngine` -> Yoga C API directly.
   - Tree ops (`insertChild/removeChild/dropNode`) -> `ZynthYogaManager`.
4. `flush()` triggers C++ Yoga layout:
   - `YGNodeCalculateLayout(...)`
   - flat frame buffer `[nodeId, left, top, width, height, ...]`
5. Kotlin `applyLayoutResults(...)` applies final `view.layout(...)`.
6. Kotlin scheduler skips Kotlin Yoga for C++-owned surfaces.

---

## Key Files

### JS Host

- `packages/zynth-core/src/host/android.ts`
  - Typed batch encoding and style prop id mapping.
  - Batch end flush behavior.

### C++ Runtime / Layout

- `packages/zynth-core/android/ZynthKit/src/main/cpp/zynthkit.cpp`
  - JSI bindings (`__ui` methods).
  - Typed batch decode.
  - C++ flush + frame sync to Kotlin.

- `packages/zynth-core/android/ZynthKit/src/main/cpp/ZynthStyleEngine.h`
- `packages/zynth-core/android/ZynthKit/src/main/cpp/ZynthStyleEngine.cpp`
  - Layout style prop mapping (`width`, `flex`, `padding`, `margin`, etc.) to Yoga C API.

- `packages/zynth-core/android/ZynthKit/src/main/cpp/ZynthYogaManager.h`
- `packages/zynth-core/android/ZynthKit/src/main/cpp/ZynthYogaManager.cpp`
  - Yoga node registry, tree mutation, layout compute, frame extraction.
  - Text measure function wiring for text nodes.

### Kotlin UI Manager / Scheduler

- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManager.kt`
  - `createNode`, `insertChild`, `setText`, `applyLayoutResults`, `measureNodeForYoga`.

- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerScheduler.kt`
  - Frame loop and Kotlin Yoga bypass for C++ owned surfaces.

- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerSurface.kt`
  - Surface lifecycle and C++ ownership cleanup.

- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerEvents.kt`
  - Node cleanup and mount state cleanup.

---

## What Is Working Now

- First frame no longer shows obvious dirty top-left flash (new mounts are hidden until first valid frame).
- Layout props (`flex`, `padding`, `gap`, etc.) are applied via C++ Yoga.
- Text visibility is restored (text measure functions attached).
- Kotlin no longer steals layout ownership after the first C++ frame for owned surfaces.

---

## Summary

Android is now using the C++ Yoga renderer path as the primary layout path for C++-owned surfaces; Kotlin is mainly applying frames and visual properties. The major remaining gap is not first-frame dirtiness anymore, but multi-frame convergence (especially during router transitions and text-heavy updates).
