# FlatList Performance Investigation: SolidJS Reconciliation Bottleneck

**Date:** October 28, 2025  
**Status:** Problem Analysis - Active Investigation  
**Last Updated:** October 28, 2025

---

## Executive Summary

This document analyzes the performance bottleneck observed in FlatList virtualization when using SolidJS's reconciliation system with a native bridge architecture (JNI). The investigation reveals that **SolidJS's asynchronous reconciliation** creates fundamental incompatibility with high-frequency native DOM manipulation.

**Key Finding:** SolidJS batches `removeChild` operations with **200-600ms delays** optimized for web DOM performance. During fast scrolling, new nodes are created every 16-32ms while old nodes are removed every 200-600ms, causing **massive memory leaks** (1000-2500+ leaked nodes).

**This document focuses exclusively on problem analysis, evidence, and attempted optimizations. Solution proposals are documented separately.**

---

## Performance Metrics

### Expected Behavior

- **Visible window:** 46 items (windowSize=5, overscan 20 items)
- **Expected nodes:** ~300-350 (46 items × ~7 nodes/item average)
- **Target flush time:** <16ms for 60fps
- **Target node lifecycle:** Create/remove within same frame (16ms)

### Observed Behavior (with SolidJS reconciliation)

#### At Item 40:

```
Node count: 710 nodes
Created: 950
Removed: 30
Leaked: 210
Slow flush: 20-30ms
```

#### At Item 390:

```
Node count: 1520 nodes (expected ~300)
Created: 4350
Removed: 354
Leaked: 2478
Operation queues: view=170, native=424
processPendingNativeOperations: 13ms
Slow flush: 19-20ms
Text rebuild: 3ms
Layout calc: 10ms
Apply layout: 4ms for 1520 nodes
```

#### Peak During Fast Scrolling:

```
Node count: 1615-2520 nodes
Operation queues: 350-547 ops
Slow flush: 61-73ms
Leak rate: ~1000 nodes per 100 items scrolled
```

### Performance Breakdown

| Operation             | Time        | Impact                     |
| --------------------- | ----------- | -------------------------- |
| Native ops processing | 1-13ms      | High when 400+ ops queued  |
| View ops processing   | 1ms         | Low                        |
| Text rebuild          | 3-9ms       | Medium when many TextViews |
| Layout calculation    | 10ms        | High for 1500+ nodes       |
| Apply layout          | 4-61ms      | Scales with node count     |
| **Total flush**       | **20-73ms** | **Exceeds 16ms budget**    |

---

## Root Cause Analysis

### The Reconciliation Delay Problem

**SolidJS Design Philosophy:**

- Optimized for web DOM performance
- Batches mutations to minimize reflows/repaints
- Defers cleanup operations to avoid blocking rendering
- Assumes cheap DOM operations (browser's C++ layer)

**Rune Reality:**

- Every DOM operation crosses JNI boundary (expensive)
- Native view creation/removal requires Kotlin/Java allocation
- Layout calculations happen on Android UI thread
- Bridge overhead: ~0.1-0.5ms per operation

**The Mismatch:**

```
Fast scroll event (every 16ms):
  ├─ VirtualWindow detects: "Remove 25 items, add 25 items" ✓ IMMEDIATE
  ├─ VirtualWindow updates Map cache ✓ IMMEDIATE
  ├─ Returns new JSX array to SolidJS ✓ IMMEDIATE
  ├─ SolidJS reconciler queues operations... ⏳ BATCHED
  │   └─ 200-600ms delay (async scheduling)
  └─ removeChild finally called ❌ TOO LATE

Meanwhile, next scroll event:
  └─ Creates 25 MORE nodes... before previous 25 removed

Result: 25 nodes/frame created - 0 nodes/frame removed = LEAK
```

### Timeline Analysis

```
T+0ms:    Items 0-45 rendered     →  300 nodes created
T+16ms:   Scroll to items 1-46    →  7 nodes created, 7 queued for removal
T+32ms:   Scroll to items 2-47    →  7 nodes created, 7 queued for removal
T+48ms:   Scroll to items 3-48    →  7 nodes created, 7 queued for removal
...
T+200ms:  Items 0 finally removed →  7 nodes removed (but 100+ created in meantime)
T+600ms:  Items 1-12 removed      →  84 nodes removed (but 300+ created)

At T+1000ms: 500 nodes created, 91 removed = 409 leaked nodes
```

---

## Architecture Overview

### Current Stack

```
User Code (SolidJS components)
  ↓ FlatList.tsx (SolidJS reactive state)
  ↓ VirtualWindow.tsx (Map-based item cache)
  ↓ SolidJS Reconciler ⚠️ BOTTLENECK
  ↓ createEffect / createMemo
  ↓ packages/rune-core/src/renderer.ts
      - insertNode(parent, child, beforeChild)
      - removeNode(parent, child)
      - insertChild(parent, child, beforeChild)
      - removeChild(parent, child)
  ↓ packages/rune-core/src/bridge.ts
      - bridge.insertChild() → JNI call
      - bridge.removeChild() → JNI call
  ↓ packages/rune-android/android/RuneKit/RuneBridge.kt
      - JNI method handlers
  ↓ packages/rune-android/android/RuneKit/RuneUIManager.kt
      - insertChild() → queues ViewOperation.Insert
      - removeChild() → queues ViewOperation.Remove
      - scheduleFlush() → posts to main thread
  ↓ packages/rune-android/android/RuneKit/RuneLayoutFlush.kt
      - processPendingViewOperations()
      - processPendingNativeOperations()
      - performLayout()
  ↓ Android Native Views
```

### Key Methods & Responsibilities

#### FlatList.tsx (2370 lines)

- **`windowedItems()`**: Calculates visible range based on scroll offset
- **`updateRenderRange()`**: Throttled range updates (MIN_RANGE_UPDATE_INTERVAL=100ms)
- **`handleScroll()`**: Processes scroll events from native
- **Configuration:**
  - `MAX_DYNAMIC_OVERSCAN_ITEMS = 20` (reduced from 48)
  - `MIN_RANGE_UPDATE_INTERVAL = 100ms` (prevents rapid range changes)
  - `windowSize = 5` (multiplier for viewport height)
  - `overscan = { multiple: 2 }` (items outside viewport)

#### VirtualWindow.tsx (90 lines) - CURRENT IMPLEMENTATION

```typescript
export function VirtualWindow<T>(props: VirtualWindowProps<T>) {
  const cache = new Map<any, any>();

  createEffect(
    on(
      () => props.items,
      (currentItems, previousItems) => {
        // Detect removals IMMEDIATELY
        const toRemove =
          previousItems?.filter(
            (prev) => !currentItems.some((curr) => curr.key === prev.key)
          ) ?? [];

        // Update Map cache synchronously
        toRemove.forEach((item) => cache.delete(item.key));

        // But SolidJS still delays the actual removeChild call by 200-600ms ⚠️
      },
      { defer: false }
    )
  );

  // Returning JSX array still goes through SolidJS reconciler
  return props.items.map((item) => {
    if (!cache.has(item.key)) {
      cache.set(item.key, props.renderItem(item));
    }
    return cache.get(item.key);
  });
}
```

**Limitation:** Even without `<For>`, returning JSX arrays triggers SolidJS reconciliation.

#### RuneUIManager.kt (1165 lines)

- **`createNode(type, id, parentId, props)`**: Creates native view instances
  - Tracks `totalNodesCreated`
  - Warns if node count exceeds 400
  - Shows leaked node calculation: `created - removed - current`
- **`removeChild(parentId, childId)`**: Queues removal operation
  - Tracks `totalNodesRemoved` (incremented here)
  - Queues `ViewOperation.Remove`
  - **Problem:** Called 200-600ms after VirtualWindow detects removal
- **`setText(id, text)`**: Sets text content
  - **Optimization:** Deduplicates last 10 operations (reverse iteration)
  - Reduces queue bloat from rapid text updates
- **`setProp(id, name, value)`**: Sets view properties
  - **Optimization:** Deduplicates last 20 operations
  - Prevents duplicate style/prop updates
- **`scheduleFlush()`**: Posts flush to main thread

  - Tracks `maxViewOperationQueueSize`, `maxNativeOperationQueueSize`
  - Logs warnings when queues exceed 150 ops

- **`logPerformanceStats()`**: Exposed to JS via `Platform.logPerformanceStats()`
  - Shows created/removed/current/leaked node counts
  - Calculates leak: `totalNodesCreated - totalNodesRemoved - currentNodeCount`

#### RuneLayoutFlush.kt (565 lines)

- **`processPendingViewOperations()`**: Executes queued view operations
  - ViewOperation.Create
  - ViewOperation.Remove → calls `RuneNodeFactory.removeNodeRecursive()`
  - ViewOperation.Update
- **`processPendingNativeOperations()`**: Executes queued native ops
  - **Optimization:** Skips ops on nodes being removed
  - Logs warning if >5ms
  - Tracks processed/skipped/prioritized counts
- **`drainPendingTextRebuilds()`**: Rebuilds TextViews
  - Logs warning if >5ms
- **`performFlush()`**: Main flush coordinator
  - Iterates until all queues empty (handles cascading ops)
  - **Performance tracking:**
    - Native ops time
    - View ops time
    - Text rebuild time
    - Layout calculation time
    - Apply layout time (scales with node count)
  - Logs breakdown when >16ms (slow flush)
  - Tracks `totalFlushes`, `slowFlushCount`, `totalFlushTime`

#### RuneNodeFactory.kt (692 lines)

- **`removeNodeRecursive(id)`**: Recursively removes node and children
  - **Line 611:** `nodes.remove(id)` - native cleanup is CORRECT
  - Type-specific cleanup (images, text inputs, scroll listeners, buttons)
  - Not the source of the leak

---

## Optimization Attempts

### ❌ Attempt 1: Node Recycling

**Approach:** Cache removed nodes, reuse for new items  
**Result:** FAILED - severe bugs

- Cross-component contamination (Button recycled as TextInput)
- Wrong data displayed in recycled views
- Crashes due to type mismatches
- **Conclusion:** Abandoned, not the right solution

### ✅ Attempt 2: Operation Deduplication

**Approach:** Remove duplicate setText/setProp before queuing  
**Implementation:**

```kotlin
// RuneUIManager.kt - setText()
val existingOpIndex = nativeOperationQueue.indexOfLast { op ->
    op is NativeOperation.SetText && op.id == id
}
if (existingOpIndex != -1) {
    nativeOperationQueue.removeAt(existingOpIndex)
}
```

**Result:** SUCCESS - reduced duplicate operations  
**Impact:** Queue sizes reduced 26 logs vs 555 before

### ✅ Attempt 3: Skip Ops on Removed Nodes

**Approach:** Don't process ops for nodes being removed  
**Implementation:**

```kotlin
// RuneLayoutFlush.kt - processPendingNativeOperations()
val removedNodeIds = pendingViewOperations
    .filterIsInstance<ViewOperation.Remove>()
    .map { it.id }
    .toSet()

val (opsToProcess, opsToSkip) = nativeOps.partition { op ->
    op.targetId !in removedNodeIds
}
```

**Result:** SUCCESS - reduced wasted work  
**Impact:** Small improvement in flush times

### ✅ Attempt 4: Reduce Overscan

**Approach:** Render fewer off-screen items  
**Changes:**

- `MAX_DYNAMIC_OVERSCAN_ITEMS`: 48 → 20
- Expected nodes: ~350 → ~300
  **Result:** SUCCESS - reduced baseline node count  
  **Impact:** Leak still occurs, but from lower baseline

### ✅ Attempt 5: Throttle Scroll Updates

**Approach:** Prevent rapid range changes  
**Changes:**

- `MIN_RANGE_UPDATE_INTERVAL`: 100ms → 200ms (increased October 28, 2025)

**Implementation:**

```typescript
const MIN_RANGE_UPDATE_INTERVAL = 200; // ms (increased from 100ms)

if (isScrolling && now - lastRangeUpdate < MIN_RANGE_UPDATE_INTERVAL) {
  return; // Skip update
}
```

**Result:** SUCCESS - eliminated crashes  
**Impact:** More stable, but blank screens during fast scroll persist. Higher throttle reduces update frequency but increases lag between scroll and content updates.

### ❌ Attempt 6: Custom VirtualWindow Component

**Approach:** Bypass SolidJS `<For>` with manual Map management  
**Iterations:**

1. Map cache with `<For>` inside → still async
2. Map cache with version signal → still async
3. Map cache with `createEffect(on(..., { defer: false }))` → still async
4. Direct array return without `<For>` → **still async** (reconciler processes any JSX array)

**Result:** FAILED - cannot bypass SolidJS reconciler  
**Impact:** Code organization improved, but fundamental delay remains

### ✅ Attempt 7: Element Cache with Stable References (October 28, 2025)

**Approach:** Cache JSX elements and return SAME references to prevent SolidJS reconciliation

**Hypothesis:** SolidJS only reconciles when JSX element references change. By caching elements and returning the same reference for each key, we might bypass reconciliation entirely.

**Implementation:**

```typescript
// In FlatList.tsx
const elementCache = new Map<string, { element: JSX.Element; dispose: () => void }>();

function getCachedElement(entry: ItemEntry<T>, idx: () => number): JSX.Element {
  const key = entry.key;

  if (!elementCache.has(key)) {
    let element: JSX.Element;
    const dispose = createRoot((disposeFn) => {
      element = (/* item JSX */);
      return disposeFn;
    });

    elementCache.set(key, { element: element!, dispose });
  }

  return elementCache.get(key)!.element; // ← SAME reference
}

// Immediate cleanup effect
createEffect(() => {
  const currentKeys = new Set(windowedItems().map(e => e.key));

  for (const [key, entry] of elementCache) {
    if (!currentKeys.has(key)) {
      entry.dispose(); // ← IMMEDIATE cleanup (0ms delay)
      elementCache.delete(key);
    }
  }
});

// Render
<For each={windowedItems()}>
  {(entry, idx) => getCachedElement(entry, idx)}
</For>
```

**Expected Result:**

- Same JSX references → No reconciliation
- `dispose()` called immediately → 0ms delay
- Node count stays ~300

**Actual Result:** TO BE TESTED  
**Status:** Implementation complete, awaiting performance validation

---

## The Reconciliation Bottleneck (Evidence)

### Logs Proving the Delay

```
10-28 17:46:19.787 [VirtualWindow] Removing 1 items        ← Detected IMMEDIATELY
10-28 17:46:19.790 [RunePerf] Node count: 1518             ← Not removed yet
...
[600ms passes]
...
10-28 17:46:20.391 [RuneUIManager] 🗑️ removeChild called   ← Finally removed
```

### Multiple removeChild Calls with Same Count

```
🗑️ removeChild called (total removed: 10)
🗑️ removeChild called (total removed: 10)  ← Stuck in batch queue
🗑️ removeChild called (total removed: 10)  ← Processing same batch
🗑️ removeChild called (total removed: 20)  ← Next batch released
```

This proves operations are batched and released in bursts, not continuously.

### Leaked Node Calculation Accuracy

```
Node count: 1750
Created: 4650
Removed: 380
Leaked: 2520

Verification: 4650 - 380 - 1750 = 2520 ✓ MATCHES
```

The formula is accurate. Nodes are created but not removed promptly.

---

## SolidJS Architectural Limitations

### Why We Can't Force Synchronous Cleanup

1. **JSX Arrays Go Through Reconciler**

   - Even without `<For>`, returning `[<Item1/>, <Item2/>]` uses reconciler
   - SolidJS must diff previous vs current arrays
   - Cleanup is deferred to batch with other mutations

2. **`removeNode()` Requires Host References**

   ```typescript
   // packages/rune-core/src/renderer.ts:480
   export const removeNode = (parent: HostElement, child: HostElement) => {
     H().removeNode(parent, child);
   };
   ```

   - Needs actual host node instances (native view references)
   - Component-level code doesn't have access to these
   - Would require invasive changes to renderer internals

3. **`createEffect` Doesn't Bypass Reconciliation**

   - Even with `defer: false`, effects run immediately
   - But cleanup is still scheduled through reconciler
   - Can detect changes, but can't force cleanup execution

4. **SolidJS Reconciler Is Not Configurable**
   - No "synchronous mode" flag
   - Batching is hardcoded for performance
   - Would require forking SolidJS core

---

## Current State Summary

### What's Working

- ✅ Crashes eliminated (200ms throttling)
- ✅ Node count settles to ~300 after scroll stops
- ✅ Operation deduplication reduces queue bloat
- ✅ Skip-ops-on-removed-nodes reduces wasted work
- ✅ Performance logging provides visibility

### What's Not Working

- ❌ 200-600ms cleanup delay during scroll
- ❌ Node count spikes to 1500+ during fast scroll
- ❌ Blank screens during very fast scrolling
- ❌ Flush times exceed 16ms budget (20-73ms)

### Current Trade-offs

1. **Temporary node buildup** (400-1600 nodes during fast scroll)
   - Settles to expected count after scroll stops
   - Memory impact limited to scroll duration
2. **Blank screens during fast scroll**
   - User must scroll slower to see content
   - Throttling prevents crashes at cost of UX
3. **Reduced responsiveness**
   - 200ms throttle means 200ms lag between scroll and content update
   - Necessary to prevent operation queue explosion

---

## Performance Metrics Summary

| Metric                 | Expected | Current (Observed) |
| ---------------------- | -------- | ------------------ |
| Visible nodes          | 300-350  | 1500-2500 (peak)   |
| Flush time             | <16ms    | 20-73ms            |
| Cleanup delay          | <16ms    | 200-600ms          |
| Leaked nodes/100 items | 0        | 1000-2000          |
| Operation queue size   | <50      | 170-547            |
| Blank screens          | None     | Frequent           |
| Crash rate             | 0%       | 0% (with throttle) |

---

## References

### Related Documentation

- `docs/virtuallist-architecture.md` - Original architecture design
- `docs/flatlist-android-plan.md` - Initial optimization plan
- `docs/android-yoga-list-optimization.md` - Layout optimizations
- `packages/rune-components/TODO.md` - Component improvements

### Key Files

- `packages/rune-components/src/primitives/FlatList.tsx` (2614 lines)
- `packages/rune-components/src/primitives/VirtualWindow.tsx` (90 lines)
- `packages/rune-android/android/RuneKit/RuneUIManager.kt` (1165 lines)
- `packages/rune-android/android/RuneKit/RuneLayoutFlush.kt` (565 lines)
- `packages/rune-core/src/renderer.ts` (host operations)

### Performance Logging APIs

```typescript
// Exposed via packages/rune-apis/src/platform.ts
Platform.logPerformanceStats(); // Shows created/removed/leaked nodes
```

```kotlin
// packages/rune-android/android/RuneKit/RuneUIManager.kt
fun logPerformanceStats() {
    val leaked = totalNodesCreated - totalNodesRemoved - currentNodeCount
    Log.e("RunePerf", "Node count: $currentNodeCount (created: $totalNodesCreated, removed: $totalNodesRemoved, leaked: $leaked)")
}
```

---

## Additional Context

### React Native Comparison

React Native faces similar challenges with native bridge overhead but uses different reconciliation strategies:

- **Fiber architecture** with incremental reconciliation
- **Batched updates** with priority scheduling
- **VirtualizedList** uses imperative scrolling and item recycling
- **FlashList** (community) uses cell recycling with pre-rendering

Worth investigating: How does React Native's Fabric renderer handle high-frequency updates across the bridge?

### SolidJS Web vs Native

SolidJS was designed for web environments where:

- DOM operations are relatively cheap (C++ browser implementation)
- Batching prevents layout thrashing and reflows
- Async scheduling improves perceived performance

In Rune's native environment:

- Every operation crosses expensive JNI boundary (~0.5ms)
- Native UI thread synchronization required
- No layout thrashing to prevent (Yoga handles layout separately)
- Batching accumulates operations faster than they can be flushed

---

**Document Version:** 2.0  
**Last Updated:** October 28, 2025  
**Authors:** Investigation team  
**Status:** Active problem analysis - solutions documented separately
