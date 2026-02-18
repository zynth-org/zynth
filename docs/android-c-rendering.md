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
- Renderer hot-path JNI lookups are cached in `RuntimeState` (no repeated `GetMethodID` in flush/batch loops).
- Flush now supports delta frame sync (only changed node frames are sent after initial sync).
- Flush now has a no-op fast path for frames with no C++ layout dirtiness and no root size changes.
- Frame output buffers are reused (C++ vector scratch + reusable `jfloatArray` when frame count is stable).

---

## Renderer Optimizations (Current)

### 1. JNI Method Cache in RuntimeState

- Cached methods include:
  - `getNodeView`
  - `markBatchNeedsLayout`
  - `getRootWidth`
  - `getRootHeight`
  - `applyLayoutResults`
- Result: fewer JNI reflection calls in hot paths (`createNode`, `setProp`, `setText`, typed batch, flush).

### 2. Delta Layout Frame Sync

- `ZynthYogaManager` now keeps a last-frame map per node and emits only changed frames after the first full sync.
- Initial flush is full sync; subsequent flushes are delta by default.
- Result: lower JNI payload size and less Kotlin-side layout application work.

### 3. No-Op Flush Guard

- `flush()` now skips Yoga calculate/frame export when:
  - no C++ layout dirtiness is pending,
  - root dimensions are unchanged,
  - and at least one C++ layout pass has already run.
- Result: reduced redundant layout work during high-frequency flush cycles.

### 4. Output Buffer Reuse

- Reused C++ frame vector (`layoutResultsBuffer`) across flushes.
- Reused `jfloatArray` global ref when frame payload size matches previous flush.
- Result: less allocator churn in both native and JNI boundaries.

### 5. Sampled Diagnostics (Optional)

- Added low-frequency renderer diagnostics support (windowed counters).
- Compile-time toggle in `zynthkit.cpp`:
  - `ZYNTH_ENABLE_RENDERER_SAMPLED_DIAGNOSTICS` (default `0`)
- Use for targeted profiling without restoring per-op debug spam.

---

## Summary

Android is now using the C++ Yoga renderer path as the primary layout path for C++-owned surfaces; Kotlin is mainly applying frames and visual properties. The major remaining gap is not first-frame dirtiness anymore, but multi-frame convergence (especially during router transitions and text-heavy updates).
