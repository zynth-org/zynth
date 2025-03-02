# FlatList Memory Leak Investigation

**Date:** October 29, 2025  
**Status:** 🔴 Critical - Memory accumulation during scroll (28MB → 150MB)  
**Severity:** High - Core virtualization component unusable at scale

---

## Executive Summary

Profiling reveals significant native memory accumulation during FlatList scrolling. Memory grows from 28MB at startup to 150MB after scrolling through ~500 items, with growth rate directly proportional to scroll speed. The leak manifests as Android native objects (RenderNode, Paint, TextPaint) that are created during scroll but never deallocated.

---

## Observed Symptoms

### Memory Growth Pattern

- **Baseline:** 28MB at app startup (before scrolling)
- **Peak:** 150MB after scrolling through ~500 items
- **Growth Rate:** Directly proportional to scroll speed
  - Faster scroll = faster memory accumulation
  - Slower scroll = slower memory accumulation
- **Behavior:** Memory does NOT decrease after scrolling stops

### User Experience Impact

- App feels sluggish after extended scrolling
- Performance degrades over time
- Potential OOM (Out of Memory) crashes on longer lists

---

## Profiling Data Analysis

### Heap Dump (at ~500 items scrolled)

#### Highest Retained Size (Java Heap)

| Class                               | Allocations | Shallow Size | Retained Size | Native Size |
| ----------------------------------- | ----------- | ------------ | ------------- | ----------- |
| `EmojiCompat` (android.emoji2.text) | -           | -            | **353**       | -           |
| `SegmentPool` (okio)                | -           | -            | **99**        | -           |

#### Highest Native Size (Native Memory)

| Class                                       | Allocations | Shallow Size | Native Size | Retained Size |
| ------------------------------------------- | ----------- | ------------ | ----------- | ------------- |
| `BinderProxy` (android.os)                  | 39          | 39,000       | **975**     | 348           |
| **`Paint` (android.graphics)**              | **340**     | **33,660**   | **41,140**  | **1,584**     |
| **`RenderNode` (android.graphics)**         | **250**     | **24,750**   | **8,000**   | **984**       |
| **`TextPaint` (android.text)**              | **179**     | **17,721**   | **27,208**  | **1,368**     |
| `Matrix` (android.graphics)                 | 65          | 6,435        | 1,040       | 640           |
| `Typeface` (android.graphics)               | 39          | 3,861        | 1,599       | 895           |
| `Path` (android.graphics)                   | 34          | 3,366        | 544         | 660           |
| `SurfaceControl$Transaction` (android.view) | -           | -            | 2,048       | 128           |
| `Binder` (android.os)                       | -           | -            | 2,000       | 160           |
| `RecordingCanvas` (android.graphics)        | -           | -            | 728         | 1,386         |

**🚨 KEY FINDING:** The top 3 native memory consumers are all Android rendering primitives:

1. **Paint (340 instances)** - Drawing contexts for rendering
2. **RenderNode (250 instances)** - Native View hierarchy nodes
3. **TextPaint (179 instances)** - Text rendering contexts

These objects should be recycled during virtualization but are accumulating instead.

---

## CPU Profiling Data

### Idle State (List Empty)

**Top Down Call Stack:**

```
com.x64bits.rune.components() ()
  └─ _libc_init() ()
      └─ main () ()
          └─ start() (android::AndroidRuntime)
              └─ CallStaticVoidMethod() (_JNIEnv)
                  └─ CallStaticVoidMethodV() (art::JNI)
                      └─ InvokeWithVarArgs() (art)
                          └─ art_quick_invoke_static_stub() ()
                              └─ main() (com.android.internal.os.ZygoteInit)
```

### Java/Kotlin Method Recording

**Top Consumer: OkHttp TaskRunner**

```
OkHttp TaskRunner() ()
  └─ run() (java.lang.Thread)
      └─ run(java.util.concurrent.ThreadPoolExecutor$Worker)
          └─ runWorker() (java.util.concurrent.ThreadPoolExecutor)
              └─ run() (okhttp3.internal.concurrent.TaskRunner$runnable$1)
                  └─ awaitTaskToRun(okhttp3.internal.concurrent.TaskRunner)
                      └─ coordinatorWait() (okhttp3.internal.concurrent.TaskRunner$RealBackend)
                          └─ wait() (java.lang.Object)
                              └─ iterator() (java.util.ArrayList)
                                  └─ execute() (okhttp3.internal.concurrent.TaskRunner$RealBackend)
                                      └─ access$runTask(okhttp3.internal.concurrent.TaskRunner)
                                          └─ getTask() (java.util.concurrent.ThreadPoolExecutor)
```

⚠️ **Note:** OkHttp activity unrelated to FlatList - may indicate bridge communication overhead.

### RuneHermesJS Thread

| Start Time | Call                     | Wall Duration | Wall Self Time | CPU Duration | CPU Self Time |
| ---------- | ------------------------ | ------------- | -------------- | ------------ | ------------- |
| 00:00.001  | run                      | 8.81ms        | 1µs            | 8.81ms       | 1µs           |
| 00:00.001  | loop                     | 8.81ms        | 3µs            | 8.81ms       | 3µs           |
| 00:00.008  | loopOnce                 | 1.15ms        | 1µs            | 1.15ms       | 1µs           |
| 00:00.008  | dispatchMessage          | 88µs          | 0µs            | 88µs         | 0µs           |
| 00:00.008  | handleCallback           | 88µs          | 0µs            | 88µs         | 0µs           |
| 00:00.008  | run                      | 11µs          | 0µs            | 11µs         | 0µs           |
| 00:00.008  | scheduleTimeout$lambda$0 | 11µs          | 0µs            | 11µs         | 0µs           |
| 00:00.008  | onTimerFired             | 11µs          | 6µs            | 11µs         | 6µs           |
| 00:00.008  | run                      | 10µs          | 0µs            | 10µs         | 0µs           |

---

## Root Cause Hypothesis

### Problem: SolidJS + Native Bridge Mismatch

The current architecture creates a **fundamental mismatch** between JavaScript reactivity cleanup and native View lifecycle:

```
┌─────────────────────────────────────────────────────────────┐
│ JavaScript Layer (SolidJS)                                   │
├─────────────────────────────────────────────────────────────┤
│ 1. User scrolls → renderRange changes                       │
│ 2. SolidJS creates NEW reactive nodes                       │
│ 3. Bridge queues "createView" operations → NATIVE LAYER     │
│ 4. SolidJS marks OLD nodes for disposal (async)             │
│ 5. Bridge queues "removeChild" operations → NATIVE LAYER    │
└─────────────────────────────────────────────────────────────┘
                         ↓ BRIDGE ↓
┌─────────────────────────────────────────────────────────────┐
│ Native Layer (Android)                                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Receives "createView" → allocates RenderNode, Paint, etc │
│ 2. Receives "removeChild" → removes from hierarchy          │
│ 3. ⚠️ PROBLEM: View removed but NOT deallocated!            │
│ 4. Native objects wait for GC (never comes)                 │
│ 5. Memory accumulates: 28MB → 150MB                         │
└─────────────────────────────────────────────────────────────┘
```

### The Gap

**JavaScript cleanup is async/deferred:**

- SolidJS uses `createRoot` disposal for cleanup
- Disposal happens "eventually" via reactive tracking
- `elementCache.dispose()` cleans JS subscriptions but NOT native Views

**Native View creation is immediate:**

- Bridge processes "createView" synchronously
- Allocates RenderNode, Paint, TextPaint immediately
- These objects are NOT cleaned up when `removeChild` is called

**Result:** Native Views are created faster than they're destroyed, causing accumulation.

---

## Current "Recycling" System Analysis

### What We Currently Recycle

✅ **JavaScript Objects** - RecyclerNode instances are reused  
✅ **JS Subscriptions** - SolidJS reactivity cleaned up via `dispose()`  
✅ **Element References** - `elementCache` prevents duplicate JSX creation

### What We DON'T Recycle

❌ **Native View Instances** - New RenderNode created on every data update  
❌ **Paint Objects** - New Paint allocated for each View  
❌ **TextPaint Objects** - New TextPaint allocated for text rendering  
❌ **Canvas Objects** - New RecordingCanvas for drawing

### The Problem with RecyclerPool

Current recycling approach:

```tsx
// RecyclerPool updates a node:
node.item = newItem; // JS object update
node.visible = true; // JS property update

// But in JSX, this renders:
<View>
  {" "}
  // ← NEW native View created!
  {renderItem(newItem)} // ← NEW Paint, TextPaint, etc.
</View>;

// Old native View:
// - Removed from hierarchy via removeChild
// - NOT deallocated
// - Waits for GC (never happens)
// - LEAKS MEMORY
```

**Why Views Aren't Reused:**

1. SolidJS sees data change (`node.item` changed)
2. Creates new JSX for `<View>{renderItem(...)}</View>`
3. Bridge translates to "createView" + "removeChild"
4. Native layer creates NEW View, removes OLD View
5. OLD View is orphaned but not destroyed

---

## Evidence Supporting Hypothesis

### 1. Memory Growth Proportional to Scroll

- **Expected:** Memory stable (recycling working)
- **Actual:** Memory grows with scroll (new Views created)
- **Conclusion:** Views are NOT being recycled natively

### 2. RenderNode/Paint Accumulation

- **250 RenderNodes** after ~500 items scrolled
- Window size is only ~12-20 items
- **Expected:** ~20 RenderNodes max (one per visible item)
- **Actual:** 12.5x more RenderNodes than needed
- **Conclusion:** Old RenderNodes are NOT being deallocated

### 3. Growth Rate Matches Scroll Speed

- Fast scroll = fast memory growth
- Slow scroll = slow memory growth
- **Interpretation:** Each scroll update creates new native Views
- Rate-limited only by scroll frequency

### 4. No Memory Recovery on Scroll Stop

- Memory stays at 150MB after scrolling stops
- **Expected:** GC would recover leaked Views
- **Actual:** Views are still referenced somewhere (leak)

---

## Bridge View Disposal Investigation Needed

### Critical Questions

1. **Does `removeChild` actually destroy native Views?**

   ```kotlin
   // Current behavior (unknown):
   fun removeChild(parent: View, child: View) {
     parent.removeView(child)  // Removes from hierarchy
     // ⚠️ Does this deallocate child?
     // ⚠️ Or does child wait for GC?
   }
   ```

2. **Are native Views waiting for Java GC?**

   - Java GC may never run if heap pressure is low
   - Native memory (RenderNode, Paint) is outside Java heap
   - Requires explicit `recycle()` or `destroy()` calls?

3. **Is there explicit View cleanup in the bridge?**
   ```kotlin
   // Should we be doing this?
   fun removeChild(parent: View, child: View) {
     parent.removeView(child)
     child.recycle()  // ← Missing?
     child.destroy()  // ← Missing?
   }
   ```

### Areas to Investigate

#### 1. Bridge Implementation

**File:** `packages/rune-android/android/RuneKit/...` (bridge view management)

Look for:

- `removeChild` / `removeView` implementation
- View cleanup/disposal logic
- Whether `recycle()` or `destroy()` is called
- GC assumptions

#### 2. View Lifecycle

- When are Views eligible for GC?
- Does removing from hierarchy trigger cleanup?
- Are Views pooled internally by Android?
- Do custom Views need explicit cleanup?

#### 3. Native Memory Management

- How does Android deallocate RenderNode?
- Do Paint/TextPaint require explicit `recycle()`?
- Is there a native finalizer that should run?
- Can we force native memory cleanup?

---

## Proposed Solutions (Priority Order)

### 🎯 Solution 1: Fix Bridge View Disposal (Immediate)

**Impact:** High | **Effort:** Low

Add explicit View cleanup in bridge `removeChild`:

```kotlin
fun removeChild(parent: ViewGroup, child: View) {
  parent.removeView(child)

  // Explicit cleanup:
  if (child is Recyclable) {
    child.recycle()
  }

  // Force native cleanup:
  child.destroyDrawingCache()
  child.background = null

  // Recursive cleanup for ViewGroups:
  if (child is ViewGroup) {
    child.removeAllViews()
  }
}
```

**Test:** Check if memory stays stable at 28MB during scroll.

---

### 🎯 Solution 2: True Native View Recycling (Medium Term)

**Impact:** Very High | **Effort:** High

Implement native-level View pooling:

```kotlin
class NativeViewPool {
  private val pool = mutableListOf<View>()

  fun acquire(type: ViewType): View {
    return pool.removeLastOrNull() ?: createView(type)
  }

  fun release(view: View) {
    // Clear properties but keep View instance alive
    view.alpha = 1f
    view.translationX = 0f
    view.translationY = 0f
    // ... reset other properties
    pool.add(view)
  }
}
```

Instead of `removeChild` → `addChild`, do:

- `acquire` from pool (reuse existing View)
- Update View properties only
- `release` back to pool when off-screen

**Benefits:**

- Zero View allocations during scroll
- Zero View deallocations
- Memory stable at ~28-40MB

---

### 🎯 Solution 3: Force Garbage Collection (Workaround)

**Impact:** Low | **Effort:** Low

Add explicit GC trigger on scroll end:

```kotlin
fun onScrollEnd() {
  // Clear references
  pendingViewRemovals.clear()

  // Force GC
  System.gc()
  System.runFinalization()
}
```

**Pros:** May help if Views are GC-eligible but not collected  
**Cons:** Causes UI jank, doesn't fix root cause

---

### 🎯 Solution 4: Reduce Window Size (Temporary Mitigation)

**Impact:** Medium | **Effort:** Very Low

```tsx
// In FlatListRecycling.tsx:
windowSize={1}  // Minimal (was 3)
overscan={{ aheadMultiple: 0, behindMultiple: 0 }}  // No overscan
```

**Expected Result:**

- Fewer Views created during scroll
- Memory growth slower but still present
- User experience degraded (more white space)

**Purpose:** Validate that View creation is the problem.

---

## Diagnostic Experiments

### Experiment 1: Disable Recycling

```tsx
enableRecycling={false}
```

**Expected:**

- If memory STILL leaks → Bridge disposal is broken
- If memory STABLE → Recycling system is broken

### Experiment 2: Force GC Button

Add button that calls `System.gc()`:

**Expected:**

- If memory DROPS significantly → Views are GC-eligible (just not collected)
- If memory STAYS HIGH → Views are still referenced (true leak)

### Experiment 3: Minimal Window

```tsx
windowSize={1}
overscan={{ aheadMultiple: 0, behindMultiple: 0 }}
```

**Expected:**

- Memory growth SLOWER but still present
- Confirms: Even visible items are leaking

### Experiment 4: Static List (No Virtualization)

```tsx
// Render all items without virtualization
{
  items().map((item) => <ItemComponent item={item} />);
}
```

**Expected:**

- Memory stable (no View churn)
- Confirms: Virtualization churn causes leak

---

## Next Steps

### Immediate Actions (This Week)

1. ✅ Document profiling data (this doc)
2. 🔲 Locate bridge `removeChild` implementation
3. 🔲 Add debug logging to track View lifecycle:
   ```kotlin
   Log.d("Bridge", "createView: ${view.id}")
   Log.d("Bridge", "removeChild: ${view.id}")
   ```
4. 🔲 Run Experiment 1 (disable recycling)
5. 🔲 Run Experiment 2 (force GC button)

### Short Term (Next Sprint)

1. 🔲 Implement Solution 1 (fix bridge disposal)
2. 🔲 Profile again to validate memory fix
3. 🔲 If not fixed, investigate Solution 2 (native pooling)

### Medium Term (Next Month)

1. 🔲 Implement native View recycling pool
2. 🔲 Refactor bridge to support View property updates (not create/destroy)
3. 🔲 Performance testing at scale (1000+ items)

---

## References

### Related Documentation

- `docs/flatlist-recycling-architecture.md` - Recycling system overview
- `docs/android-bridge-communication.md` - Bridge operation details
- `packages/rune-components/src/primitives/FlatList.tsx` - FlatList implementation
- `packages/rune-components/src/primitives/RecyclerPool.tsx` - RecyclerPool implementation

### Android Memory Management Resources

- [Android View Recycling Best Practices](https://developer.android.com/topic/performance/vitals/render)
- [RecyclerView Architecture](https://developer.android.com/guide/topics/ui/layout/recyclerview)
- [Native Memory Management](https://developer.android.com/topic/performance/memory-overview)

---

## Conclusions

1. **Memory leak is confirmed** - 28MB → 150MB is a 5.4x increase
2. **Leak is in native layer** - RenderNode, Paint, TextPaint accumulation
3. **Likely cause:** Views removed from hierarchy but not deallocated
4. **Current recycling doesn't work natively** - Only recycles JS objects
5. **Investigation priority:** Bridge `removeChild` implementation

**Recommendation:** Focus on Solution 1 (fix bridge disposal) first. If that doesn't resolve the issue, implement Solution 2 (native View pooling).

---

**Last Updated:** October 29, 2025  
**Investigators:** Development Team  
**Status:** 🔴 Investigation In Progress
