# Android VirtualList Yoga Layout Optimization

## Problem Statement

VirtualList items currently have **two layout approaches**:

1. **Manual Layout (Current)**: Limited style support - only `backgroundColor`, `borderRadius`, `padding`, `margin`

   - Missing: `width`, `height`, `flex`, `gap`, `borderWidth`, `alignItems`, `justifyContent`, etc.
   - Performance: ✅ Fast (0.5ms per item bind)

2. **Yoga Layout (Attempted)**: Full CSS-like style support using Yoga layout engine
   - Supports: All ~40+ Yoga properties (dimensions, flex, spacing, alignment)
   - Performance: ❌ Slow (5-10ms per item bind) → **Causes scroll jank**

### Why Yoga is Slow

RecyclerView's core optimization is **view recycling** - reusing existing views instead of recreating them:

```kotlin
// Good (Manual Layout):
onBindViewHolder() {
  view.text = "New Data"  // 0.5ms
}

// Bad (Current Yoga Implementation):
onBindViewHolder() {
  // Create 5-10 Yoga nodes
  engine.createNode(id1), createNode(id2)...  // 2ms
  // Parse JSON → Style
  Style.fromJson(json)  // 1ms
  // Calculate Yoga layout (C++ JNI call)
  engine.calculateLayout(width, height)  // 3ms
  // Apply frames
  applyFrames()  // 1ms
  // Cleanup
  engine.removeNode(id1), removeNode(id2)...  // 1ms
  // Total: 8ms per item
}
```

**Impact on 60 FPS Scrolling:**

- 60 FPS = 16ms per frame budget
- Fast scroll showing 5 new items/frame = 5 × 8ms = **40ms** → Drops to ~25 FPS ❌
- Fling showing 10 items/frame = 10 × 8ms = **80ms** → Unusable lag ❌

### Root Cause

We're **recreating the entire Yoga layout tree on every RecyclerView bind** instead of caching the computed layout. This defeats RecyclerView's purpose.

---

## Solution: Frame Caching

### Key Insight

**Item layouts are deterministic** - a contact list item with "John Doe" has the **same layout** as "Jane Smith". We only need to calculate Yoga layout **once per unique item structure**, not per scroll event.

### Architecture

```kotlin
// Cache: ItemStructureHash → ComputedLayout
private val yogaLayoutCache = LruCache<String, CachedLayout>(maxSize = 100)

data class CachedLayout(
  val frames: Map<Int, Rect>,  // Yoga node ID → computed frame
  val viewStructure: ViewTree,  // Tree of view types/IDs for reuse
  val timestamp: Long
)
```

### Implementation Strategy

#### Phase 1: Compute Structure Hash

```kotlin
fun VirtualNode.computeStructureHash(): String {
  // Hash based on:
  // - Node type (View/Text)
  // - Style properties (width, height, flex, etc.)
  // - Children structure (recursive)
  // - NOT data (text content, specific values)

  return buildString {
    append(this@computeStructureHash.javaClass.simpleName)
    append("|")
    append(styleJson?.let { hashStyleProperties(it) } ?: "")
    append("|")
    if (this@computeStructureHash is VirtualNode.ViewNode) {
      append(children.joinToString(",") { it.computeStructureHash() })
    }
  }.hashCode().toString()
}

private fun hashStyleProperties(styleJson: String): String {
  // Hash only layout-affecting properties, ignore colors/text
  val style = Style.fromJson(styleJson)
  return listOf(
    style.width, style.height, style.flex,
    style.margin, style.padding, style.gap,
    style.flexDirection, style.alignItems
  ).hashCode().toString()
}
```

#### Phase 2: Cache-Aware createView

```kotlin
private fun createView(
  context: Context,
  node: VirtualNode,
  parent: ViewGroup
): View {
  val engine = layoutEngine ?: return createViewManual(context, node, parent)

  // Compute structure hash
  val structureHash = node.computeStructureHash()

  // Try cache first
  val cached = yogaLayoutCache.get(structureHash)

  return if (cached != null) {
    // FAST PATH: Reuse cached layout (0.5ms)
    buildViewFromCache(context, node, cached)
  } else {
    // SLOW PATH: Compute Yoga layout (5ms, but only once)
    val (view, layout) = buildYogaTreeAndCache(context, node, engine)
    yogaLayoutCache.put(structureHash, layout)
    view
  }
}
```

#### Phase 3: Apply Cached Frames

```kotlin
private fun buildViewFromCache(
  context: Context,
  node: VirtualNode,
  cached: CachedLayout
): View {
  // Build Android view tree (fast, no Yoga)
  val view = buildViewTreeWithoutYoga(context, node)

  // Apply pre-computed frames from cache
  applyFramesFromCache(view, cached.frames, cached.viewStructure)

  // Apply visual styles (colors, text)
  applyVisualStyles(view, node)

  return view
}

private fun applyFramesFromCache(
  view: View,
  frames: Map<Int, Rect>,
  structure: ViewTree
) {
  // Look up frame by view ID in structure
  val frame = frames[structure.yogaNodeId] ?: return

  // Apply dimensions
  view.layoutParams = ViewGroup.LayoutParams(
    frame.right - frame.left,
    frame.bottom - frame.top
  )

  // Recurse for children
  if (view is ViewGroup && structure is ViewTree.Container) {
    for ((i, childStructure) in structure.children.withIndex()) {
      applyFramesFromCache(view.getChildAt(i), frames, childStructure)
    }
  }
}
```

#### Phase 4: LRU Cache Management

```kotlin
private val yogaLayoutCache = object : LruCache<String, CachedLayout>(100) {
  override fun sizeOf(key: String, value: CachedLayout): Int {
    // Count number of nodes in layout (more accurate than entry count)
    return value.frames.size
  }

  override fun entryRemoved(
    evicted: Boolean,
    key: String,
    oldValue: CachedLayout,
    newValue: CachedLayout?
  ) {
    // Optional: Log cache evictions for debugging
    if (evicted) {
      Log.d("VirtualList", "Evicted layout cache for structure: $key")
    }
  }
}
```

---

## Performance Analysis

### Without Caching (Current Yoga Attempt)

| Scenario      | Items/Frame | Cost/Frame | FPS | Result         |
| ------------- | ----------- | ---------- | --- | -------------- |
| Slow scroll   | 3           | 24ms       | 42  | ⚠️ Slight jank |
| Normal scroll | 5           | 40ms       | 25  | ❌ Visible lag |
| Fast fling    | 10          | 80ms       | 12  | ❌ Unusable    |

### With Caching (Proposed)

| Scenario   | Cache State          | Cost/Frame    | FPS | Result            |
| ---------- | -------------------- | ------------- | --- | ----------------- |
| Cold start | First 50 items       | 5ms × items   | ~40 | ⚠️ Initial warmup |
| Warm cache | Scrolling seen items | 0.5ms × items | 60  | ✅ Perfect        |
| Mixed      | 80% cached + 20% new | 1.5ms × items | 60  | ✅ Smooth         |

**Result**: After ~50 unique item layouts are cached (first scroll through list), performance matches manual layout while supporting ALL Yoga properties.

---

## Implementation Checklist

### Phase 1: Basic Caching (MVP)

- [ ] Implement `VirtualNode.computeStructureHash()`
- [ ] Create `CachedLayout` data class
- [ ] Add `LruCache<String, CachedLayout>` to RuneVirtualListView
- [ ] Implement cache lookup in `createView()`
- [ ] Build `buildViewFromCache()` to reuse layouts
- [ ] Test: Scroll same items 5× → should be instant after first pass

### Phase 2: Optimization

- [ ] Profile cache hit rate (log hits vs misses)
- [ ] Tune LRU cache size (100 entries = ~100KB memory)
- [ ] Optimize hash computation (avoid repeated JSON parsing)
- [ ] Add cache metrics to DevTools

### Phase 3: Edge Cases

- [ ] Handle dynamic item size changes (invalidate cache on style change)
- [ ] Support mixed Yoga + Manual items (opt-in per item)
- [ ] Test with horizontal VirtualList
- [ ] Test with separator/header/footer decorators

### Phase 4: Advanced (Future)

- [ ] Shared cache across multiple VirtualLists in same screen
- [ ] Persistent cache (disk) for app-wide item templates
- [ ] Lazy Yoga calculation (off main thread using coroutines)
- [ ] Measure function support for dynamic content (e.g., multiline text)

---

## Alternative Approaches Considered

### 1. Pre-compute All Layouts Upfront

**Idea**: Calculate Yoga layout for all items before rendering

```kotlin
val layouts = data.map { item -> computeYogaLayout(item) }
```

**Pros**: Zero cost during scroll
**Cons**:

- Initial load time for 1000 items = 5 seconds ❌
- Memory: 1000 items × 5KB/layout = 5MB
- Doesn't work for infinite lists

### 2. Hybrid Manual + Yoga

**Idea**: Use manual layout for simple items, Yoga for complex

```kotlin
if (item.hasComplexLayout) {
  createViewWithYoga()
} else {
  createViewManual()
}
```

**Pros**: Best of both worlds
**Cons**:

- Requires user to annotate items as "complex"
- Mixed mental model (two layout systems)

### 3. Web-style Virtual DOM Diffing

**Idea**: Compare previous vs current item, only re-layout if structure changed
**Pros**: Automatic optimization
**Cons**:

- Adds diff overhead (2ms/item)
- Complex to implement correctly
- Still slower than caching

**Recommendation**: Stick with **Frame Caching (Solution)** - simplest, fastest, most maintainable.

---

## Testing Strategy

### Unit Tests

```kotlin
@Test
fun `cache returns same layout for identical structures`() {
  val node1 = VirtualNode.ViewNode(
    styleJson = """{"width": 100, "height": 50}""",
    children = emptyList()
  )
  val node2 = VirtualNode.ViewNode(
    styleJson = """{"width": 100, "height": 50}""",
    children = emptyList()
  )

  val hash1 = node1.computeStructureHash()
  val hash2 = node2.computeStructureHash()

  assertEquals(hash1, hash2)
}

@Test
fun `cache distinguishes different layouts`() {
  val node1 = VirtualNode.ViewNode(
    styleJson = """{"flexDirection": "row"}""",
    children = emptyList()
  )
  val node2 = VirtualNode.ViewNode(
    styleJson = """{"flexDirection": "column"}""",
    children = emptyList()
  )

  assertNotEquals(node1.computeStructureHash(), node2.computeStructureHash())
}
```

### Integration Tests

```kotlin
@Test
fun `scroll performance with cache vs without`() {
  val items = (1..100).map { createItem(it) }

  // Measure without cache
  val timeWithoutCache = measureTimeMillis {
    items.forEach { renderItem(it, useCache = false) }
  }

  // Measure with cache (second pass)
  val timeWithCache = measureTimeMillis {
    items.forEach { renderItem(it, useCache = true) }
  }

  assertTrue(timeWithCache < timeWithoutCache / 5) // 5x faster
}
```

### Manual Testing Checklist

- [ ] Load list with 1000 items → scroll smoothly
- [ ] Fast fling → maintains 60 FPS
- [ ] Change item data (not structure) → renders instantly
- [ ] Change item structure → re-calculates layout, caches new version
- [ ] Memory usage stable (LRU eviction working)
- [ ] Hot reload preserves cache (or clears gracefully)

---

## Migration Path

### Step 1: Keep Manual Layout as Default (Current)

```kotlin
private fun createView(context: Context, node: VirtualNode, parent: ViewGroup): View {
  // Use manual layout until caching is implemented
  return createViewManual(context, node, parent)
}
```

### Step 2: Implement Caching (This Doc)

Add caching layer, enable Yoga with flag:

```kotlin
private val USE_YOGA_LAYOUT = BuildConfig.DEBUG // Test in debug first
```

### Step 3: Gradual Rollout

1. Enable for developers → collect metrics
2. Enable for beta users → monitor crash reports
3. Enable for 10% of production → A/B test performance
4. Roll out to 100% if metrics good

### Step 4: Remove Manual Fallback (Future)

Once Yoga + caching is proven stable:

```kotlin
private fun createView(context: Context, node: VirtualNode, parent: ViewGroup): View {
  return createViewWithYogaAndCache(context, node, parent)
}
```

---

## Expected Outcomes

### Performance Metrics (After Optimization)

- **Scroll FPS**: 60 (same as manual layout)
- **Cache Hit Rate**: 95%+ for typical lists
- **Memory Overhead**: ~2-5MB for 100 cached layouts
- **Initial Load**: +50ms for first scroll (one-time cost)

### Developer Experience

- ✅ Full Yoga style support (width, height, flex, gap, etc.)
- ✅ No performance regression
- ✅ Same API as current VirtualList
- ✅ Separators, headers, footers work perfectly

### User Experience

- ✅ Smooth 60 FPS scrolling
- ✅ Complex layouts (nested flex, gaps) work
- ✅ No jank during fast flings
- ✅ Instant response to taps/gestures

---

## Timeline Estimate

| Phase     | Task                         | Effort           | Dependencies |
| --------- | ---------------------------- | ---------------- | ------------ |
| 1         | Implement structure hashing  | 2-3 hours        | None         |
| 2         | Add LruCache + cache lookup  | 1-2 hours        | Phase 1      |
| 3         | Implement buildViewFromCache | 3-4 hours        | Phase 2      |
| 4         | Testing + edge cases         | 2-3 hours        | Phase 3      |
| 5         | Performance profiling        | 1-2 hours        | Phase 4      |
| **Total** | **MVP Implementation**       | **~10-14 hours** |              |

**Note**: This is a one-time investment that unlocks full Yoga support for VirtualList items without performance penalty.

---

## References

- [Yoga Layout Engine](https://yogalayout.dev/) - Flexbox implementation
- [RecyclerView Performance](https://developer.android.com/develop/ui/views/layout/recyclerview) - Android best practices
- [LruCache Documentation](https://developer.android.com/reference/android/util/LruCache) - Android caching
- `RuneVirtualListView.kt` - Current implementation
- `Style.kt` - Yoga style parsing

---

## Open Questions

1. **Should we cache across different VirtualLists?**

   - Pro: Better hit rate for repeated patterns
   - Con: More complex cache key (include list ID?)

2. **How to handle dynamic content (multiline text)?**

   - Text height depends on actual content, not just structure
   - Solution: Include text length bucket in hash? (0-50 chars, 50-100, etc.)

3. **Parallel Yoga calculation?**

   - Can we calculate layout on background thread?
   - Yoga is thread-safe, but Android View creation is not

4. **Cache invalidation strategy?**
   - Time-based expiration?
   - Size-based LRU eviction? (current approach)
   - Manual invalidation API?

---

**Status**: Optimization NOT YET IMPLEMENTED - Manual layout fallback currently active
**Priority**: High - Blocks full Yoga style support for VirtualList
**Owner**: TBD
**Updated**: 2025-10-25
