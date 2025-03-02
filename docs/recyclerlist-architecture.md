# RecyclerList Performance Investigation

## The Problem

When implementing a high-performance virtualized list component (`FlatList`) in the Rune framework, we encountered severe performance issues on Android:

- **Excessive node creation**: `created=5338, active=141` nodes during scrolling
- **Memory spikes**: `Others = 385 MB` memory usage
- **Poor scroll performance**: Creating/destroying hundreds of nodes per small scroll (10px scroll = 1500+ logs)
- **Items disappearing**: Content vanishing after scrolling past certain points
- **Bridge overload**: Constant communication between JavaScript and native layers

## Why This Happens: SolidJS Reconciliation Model

SolidJS uses a **reactive reconciliation system** optimized for DOM/web environments where:

- Creating/destroying DOM nodes is relatively cheap
- Fine-grained reactivity minimizes update costs
- The `<For>` component uses **keyed reconciliation** to efficiently update lists

However, in Rune's **cross-platform native architecture**:

1. **Every node creation crosses the bridge** to native (expensive)
2. **Native views are heavyweight** compared to DOM elements
3. **Bridge communication overhead** becomes the bottleneck
4. **Yoga layout engine** must recalculate on every change

### The Core Issue with `<For>`

When using SolidJS's `<For>` component:

```tsx
<For each={windowedItems()}>{(item) => <ItemView item={item} />}</For>
```

**What happens on scroll:**

1. Windowing logic updates: `items [0-9]` → `items [1-10]`
2. SolidJS sees keys changed (item 0 removed, item 10 added)
3. SolidJS **destroys** the node for item 0
4. SolidJS **creates** a new node for item 10
5. Both operations cross the bridge to native
6. Native destroys View, creates new View, runs layout
7. **Repeat for every tiny scroll change**

This is by design! SolidJS's reconciliation is **reactive and keyed** - it creates/destroys based on data presence and keys.

## Failed Attempts

### Attempt 1: Host-Level Recycling with SolidJS `<For>`

**Approach**: Modified the Host layer (android.ts) to intercept `createNode` and `removeNode`, maintaining a recycling pool.

**Why it failed**:

- SolidJS's `<For>` still called create/remove on every scroll change
- Recycling pool was always empty when `createNode` was called
- Timing issue: SolidJS creates new nodes BEFORE removing old ones
- Result: Pool never had nodes available for reuse

### Attempt 2: Batch Metadata Propagation

**Approach**: Used `beginBatch`/`endBatch` to pass recycling metadata through render cycles.

**Why it failed**:

- SolidJS's lazy evaluation meant batches closed before nodes were actually created
- Metadata arrived too late at the Host layer
- Batch timing didn't align with SolidJS's reconciliation schedule

### Attempt 3: ScrollView Ref Tracking + Delayed Recycling

**Approach**: Used `createEffect` and `queueMicrotask` to enable recycling after initial render.

**Why it failed**:

- Initial nodes created before recycling context was enabled
- Retroactive marking didn't work because nodes were already in wrong state
- Children disappeared because both parent Views and nested Text nodes were recycled separately

### Attempt 4: StableRecyclerList with `<For>` and Stable Keys

**Approach**: Used stable pool indices as keys instead of data keys, hoping SolidJS wouldn't recreate nodes.

**Why it failed**:

- When slots became invisible, we returned `null`
- SolidJS unmounts components that return `null`, destroying the nodes
- Result: Still saw `DESTROYED node X` logs on every scroll
- **Fundamental issue**: Can't hide nodes by returning null - SolidJS removes them

### Attempt 5: ImperativeRecyclerList with Host API

**Approach**: Imperatively created View nodes via `host.createNode()`, bypassing SolidJS for containers.

**Why it failed**:

- Imperative nodes had no content - they were empty Views
- SolidJS rendered `MiniRecyclerSlot` components separately, not as children of imperative nodes
- Two separate trees: imperative containers + SolidJS content, never connected
- **Fundamental issue**: Can't mix imperative node creation with SolidJS content rendering

## Current Approach: RecyclerPoolList with `<Index>`

### Why `<Index>` Instead of `<For>`

SolidJS provides `<Index>` as an alternative to `<For>`:

**`<For>` behavior**:

- Keys by data: Each item has a unique key from `keyExtractor`
- When data changes, compares keys to determine what to create/destroy
- Optimized for **stable data where items change infrequently**

**`<Index>` behavior**:

- Keys by **array position**: Slot 0, Slot 1, Slot 2...
- Array position never changes (fixed pool size)
- Only updates the **content** when binding changes
- Optimized for **stable structure where content changes**

### Architecture

```tsx
// Fixed-size bindings array (never changes length)
const bindings = [
  { poolIndex: 0, dataIndex: 2, item: data[2] }, // Slot 0 shows item 2
  { poolIndex: 1, dataIndex: 3, item: data[3] }, // Slot 1 shows item 3
  { poolIndex: 2, dataIndex: -1, item: null }, // Slot 2 offscreen
  // ... always same number of slots
];

<Index each={bindings}>
  {(binding) => {
    // This View is NEVER destroyed
    // Only its content and position update
    <View style={{ top: binding().dataIndex * itemSize }}>
      {binding().item && renderItem(binding().item)}
    </View>;
  }}
</Index>;
```

**On scroll:**

1. Windowing updates: range `[0-9]` → `[1-10]`
2. Update bindings: Slot 0 changes from `dataIndex:0` to `dataIndex:10`
3. SolidJS sees: Same array length, same slot positions
4. SolidJS updates: Only the **reactive content** inside the View
5. **No create/destroy** - just property updates!

### Key Differences from Previous Attempts

1. **Uses SolidJS throughout** - no imperative node management
2. **Fixed array length** - pool size never changes after initialization
3. **Position-based keying** - `<Index>` keys by slot, not data
4. **Always renders slots** - Views stay in tree, just reposition offscreen
5. **Absolute positioning** - Moves items via `top`/`left` style properties

## Current Challenges

### Challenge 1: Pool Size Initialization

**Problem**: Viewport size is unknown during initial render, leading to undersized pools.

**Current solution**: Use generous minimum (15 slots) to cover typical screens.

### Challenge 2: Overscan Tuning

**Problem**: Large overscan keeps item 0 in range even when scrolled, preventing recycling.

**Current solution**: Reduced overscan from `itemSize * 5` to `itemSize * 2`.

### Challenge 3: Pool Exhaustion

**Problem**: Pool runs out of slots when more items visible than pool size.

**Status**: Being addressed by proper pool sizing and overscan tuning.

## Why This Approach Has Potential

1. **Works with SolidJS, not against it**: Uses `<Index>` as designed
2. **Referential stability**: Array positions never change, preventing reconciliation
3. **Pure reactive updates**: Only content changes, structure stays fixed
4. **No bridge spam**: Position updates are simple property changes
5. **Predictable performance**: Fixed node count regardless of scroll position

## Technical Insights

### SolidJS is Designed for Web

- **DOM is cheap**: Creating `<div>` elements has minimal cost
- **No bridge overhead**: Direct memory access to DOM
- **Optimized for change**: Fine-grained reactivity shines with frequent updates

### Native Views are Expensive

- **Bridge crossing**: Every operation serialized and sent across
- **Layout engine**: Yoga recalculates flexbox on changes
- **Memory weight**: Native views consume significant memory
- **Platform differences**: iOS/Android have different rendering pipelines

### The Impedance Mismatch

SolidJS's strengths (reactive, fine-grained updates) become liabilities when:

- Every update crosses an expensive bridge
- Native operations are heavyweight
- Predictability matters more than reactivity
- Fixed structure is better than dynamic reconciliation

## Conclusion

The fundamental challenge is that **SolidJS's reconciliation model is optimized for web DOM**, where create/destroy is cheap and reactivity overhead is minimal. In a cross-platform native framework with bridge communication, we need:

1. **Predictable node lifecycle**: Fixed pool that never grows/shrinks
2. **Minimal reconciliation**: Structure changes rarely, content updates frequently
3. **Position-based identity**: Slots identified by position, not data keys
4. **Imperative positioning**: Moving items via properties, not recreation

`<Index>` provides these properties by design, making it the right primitive for this use case. The remaining work is tuning (pool size, overscan) rather than architectural changes.
