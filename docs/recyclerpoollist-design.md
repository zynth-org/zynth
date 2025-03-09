# RecyclerPoolList Architecture Guide

## Why We Needed a New List

The original `FlatList` leaned on Solid's `<For>` reconciliation, which is perfect for the DOM but hostile to Rune's native bridge:

- Every scroll mutation removed one item key and inserted another, so Solid created and destroyed native views constantly.
- The host recycling pool never had spare nodes—Solid always asked for a new node **before** it removed an old one—so every scroll crossed the bridge and inflated "Others"/"Native" memory.
- Yoga ran full layout for each create/remove, the bridge flooded, and Android reported >350 MB usage around item 400.

After many attempts to intercept creation at the host layer, we inverted the strategy: keep Solid from asking for new nodes in the first place. `RecyclerPoolList` is the result.

## Design Goals

1. **Fixed native node count** – warm a pool once, then reuse the same views forever.
2. **Solid-friendly reactivity** – let list items remain reactive without triggering reconciliation churn.
3. **Host-assisted recycling** – cooperate with the Android/iOS host so nested native nodes are reclaimed.
4. **Predictable memory** – avoid unbounded growth while preserving smooth flings.

Every decision in `RecyclerPoolList` maps to one of these goals.

## Core Mechanisms

### 1. Stable Pool Backed by `<Index>`

```ts
const [bindings, setBindings] = createSignal<Binding[]>([
  { poolIndex: 0, dataIndex: -1 },
  …
]);

<Index each={bindings()}>
  {(binding) => /* slot view */}
</Index>;
```

- We pre-allocate an array of `Binding { poolIndex, dataIndex }` objects whose length equals the pool size.
- Solid's `<Index>` keys by **position**, not data, so each slot is never destroyed; only its `dataIndex` changes.
- The range calculator (`visibleRange`) updates `dataIndex` values as the user scrolls, but the array reference never changes. Solid skips reconciliation, and no new nodes are requested from the host.

### 2. Per-Slot Render Root with Live Proxies

```ts
const [currentItem, setCurrentItem] = createSignal<T | null>(null);
const [currentIndex, setCurrentIndex] = createSignal(-1);

const itemProxy = new Proxy({}, { get: () => currentItem()?.[prop], … }) as T;
const indexValue = { valueOf: () => currentIndex(), … } as unknown as number;

slotContent = createRoot((dispose) =>
  props.renderItem({ item: itemProxy, index: indexValue })
);
```

- Each pool slot spins up a `createRoot` exactly once. The JSX tree sits inside that root permanently.
- Instead of re-rendering, we update reactive signals. The proxy feeds the latest item properties to Solid's fine-grained signals without invalidating the component tree.
- When `dataIndex` changes, only `setCurrentItem` / `setCurrentIndex` run. Solid re-executes the minimal effects (text, styles), the host receives `setProp` / `setText` updates, and no nodes are created.

### 3. Host-Level Recycling Context

```ts
const host = getHost();
recyclingContextId = host.enableRecycling(scrollNode.id, {
  poolSize,
  itemType: "view",
});
```

- As soon as the native `ScrollView` reference arrives, we register a recycling context with the host.
- Android's `RuneNodeFactory`/`RuneUIManager` now tag **every descendant** of the scroll container with that context (e.g. outer `<View>`, inner `<View>`, `<Text>`). When Solid removes children, the host returns them to the pool instead of destroying them.
- During rebinding, when Solid asks for a node, the host fetches from the pool (`findAvailableNodeInPool`) instead of calling `createNode`. This eliminates bridge churn after the initial warm-up.

### 4. Range & Binding Logic

The scroll controller exposes metrics (`offset`, `viewportSize`). On each scroll:

1. We compute `startIndex` / `endIndex` with overscan (±2 items).
2. We unbind slots whose `dataIndex` falls outside the range by setting `dataIndex = -1`.
3. We bind freed slots to new data indices, logging the key for diagnostics.
4. We update per-slot signals, which rehydrate the item proxy and index.

Because the pool size equals `visible + overscan`, we never exhaust slots, and the same native nodes rotate through positions.

### 5. Horizontal Support

The same mechanics work on both axes:

- `horizontal` toggles which scroll offset and viewport dimension we read.
- `itemSize` is interpreted along the **primary** axis—height for vertical lists, width for horizontal lists.
- Slot positioning flips from `top` to `left`, and the container swaps `width`/`height` assignments.

No other changes are required; the pool logic and proxies remain identical.

## Why Node Creation Is Controlled

- `<Index>` means Solid never calls `createNode` for the slot container after initialization.
- Proxies ensure Solid's fine-grained dependencies sit on `currentItem` signals, not on the binding array, so content reacts without forcing reconciliation.
- Host recycling returns nested children (`view`, `text`, etc.) to the pool. Subsequent `setProp` / `setText` operations mutate the existing node.
- Only the first mount and the initial scroll (which fills the overscan range) allocate nodes. After that, logcat shows `♻️ REUSING node …` instead of `🆕 CREATED`.

If we removed any of these layers:

- Using `<For>` would recreate nodes when indices shift.
- Skipping the slot-level `createRoot` would cause Solid to dispose/recreate the render subtree, reinserting native nodes.
- Without `enableRecycling`, the host would destroy nested text nodes, forcing new `createText` calls on every update.

## Comparison with Legacy FlatList

| Aspect | Legacy FlatList | RecyclerPoolList |
| --- | --- | --- |
| Solid primitive | `<For>` keyed by item | `<Index>` keyed by slot |
| Item rendering | New element per key change | Persistent per-slot root |
| Host cooperation | Opportunistic, often missed | Explicit recycling context |
| Node lifecycle | create/remove per scroll | Warm once, reuse |
| Memory profile | >350 MB by item 400 | ~55 MB after full sweep |
| Scroll smoothness | Layout thrash, bridge spam | Stable bridge traffic |

The existing `FlatList` does have a host pool, but Solid's reconciliation pattern ensures the pool is empty whenever `createNode` is invoked. `RecyclerPoolList` keeps the pool hot because Solid never asks for more structural nodes.

## Operational Observations

- First render and first scroll populate the pool (you'll see ~60 node creations). Afterwards, scrolling produces only `♻️ REUSING` logs.
- Android Studio profiler shows "Native" / "Others" rising to ~55 MB during a long fling, then falling back as GC collects transient Solid objects.
- No more gap/render delays—Yoga repositions the same nodes, avoiding layout bubbles.

## Next Steps

- Productize `RecyclerPoolList` as the new `FlatList` export.
- Migrate consumers by swapping the primitive and updating props (the API matches FlatList's essential contract).
- Consider adding optional instrumentation hooks (e.g. slot reuse stats) for future regressions.

`RecyclerPoolList` works because it treats Solid as a fine-grained state engine, not a reconciler. Once we stop asking for new nodes, the host pool does the rest, eliminating the memory leaks that kept FlatList from shipping.
