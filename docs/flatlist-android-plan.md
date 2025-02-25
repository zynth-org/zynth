# Android FlatList Refactor Plan

## Goals
- Deliver a recorder-free FlatList experience on Android that can render any existing primitive (Button, TextInput, Image, etc.) without bespoke serialization work.
- Preserve or surpass VirtualList performance characteristics by reusing Yoga layout caching, RecyclerView pooling, and structure hashing.
- Keep the existing FlatList API surface (controller methods, viewability callbacks, maintainVisibleContentPosition) so callers do not need to change their JSX.
- Ship the new implementation only on Android while iOS continues to rely on the current ScrollView-based FlatList.

## High-Level Architecture
1. **New Host Component** – Introduce a `flat-list` host node that Solid can mount. This host proxies data/control props into the native Android renderer instead of wrapping `<ScrollView>`.
2. **Template Streaming** – Instead of serializing items, Solid will render each row into an off-screen template container, capture the resulting host subtree, and provide that template reference to the native side. RecyclerView clones/templates those nodes when binding cells.
3. **Native Renderer** – Implement `RuneFlatListView` (RecyclerView-based) that:
   - Requests templates as needed from JS.
   - Builds per-template Yoga trees, caching layouts the same way `RuneVirtualListView` does (`yogaLayoutCache`, structure hashes, size constraints).
   - Recycles host nodes and forwards events through the existing `RuneNodeFactory` plumbing, so Button/Pressable/TextInput keep their built-in behaviors.
4. **Controller & Metrics** – Mirror the existing FlatList controller API by routing scroll commands, metrics, viewability updates, and maintain-visible-content-position signals through the new host.

## Phase 1 — Infrastructure & Template Capture
1. **Host Type & JSX wiring**
   - Add `flat-list` to `HostTypes`/JSX definitions so Solid can emit `<flat-list>` nodes.
   - Extend the host renderer to recognize the new type and dispatch creation/removal to the platform bridge.
2. **Template lifecycle utilities**
   - Build JS helpers to render each FlatList item into an off-screen root, freeze the resulting host subtree, and hand its node ID + metadata to the bridge.
   - Track template reuse keyed by `keyExtractor` + render output signature so repeated items share a template.
   - Provide invalidation hooks (e.g., when props/styles change or `layoutInvalidationKey` updates) to evict cached templates.
3. **Bridge protocol**
   - Define commands/events between JS and Android for:
     - `requestTemplate(key, hash)` → JS responds with template node reference and metadata.
     - `releaseTemplate(id)` when RecyclerView no longer needs it.
     - `applyLayoutCache(hash, width)` to retrieve cached Yoga frames.

## Phase 2 — Android Renderer & Yoga Cache
1. **RuneFlatListView**
   - Implement a RecyclerView container (adapter + view holders) that binds templates requested from JS.
   - Integrate with `RuneNodeFactory` to clone host subtrees for each cell, ensuring events and props flow exactly like regular nodes.
2. **Yoga caching**
   - Reuse the structure hashing and `yogaLayoutCache` logic from `RuneVirtualListView` to avoid recomputing layouts.
   - Capture frames whenever a template is measured and store them keyed by hash + constraint width.
3. **Scroll metrics & controller**
   - Surface scroll position, velocity, and viewport/content sizes back to JS via the existing `ScrollController` interface.
   - Implement `scrollToOffset`, `scrollToIndex`, `scrollToEnd`, and `flashScrollIndicators` using RecyclerView APIs.
4. **Viewability & MVCP hooks**
   - Provide callbacks for visible item ranges so JS viewability trackers continue to work.
   - Support maintain-visible-content-position by anchoring to a template/key and adjusting offsets when data prepends/appends.

## Phase 3 — Integration & Rollout
1. **JS FlatList shim**
   - Update `packages/rune-components/src/primitives/FlatList.tsx` to:
     - Detect `Platform.OS === "android"` and render the new `<flat-list>` host with the captured templates.
     - Fall back to the existing ScrollView-based implementation on other platforms.
     - Preserve the public API (props, controller, events).
2. **Testing & Validation**
   - Add unit tests for template caching, controller commands, and bridge message flow.
   - Build Android instrumentation tests that scroll long lists, verify no blank gaps, and ensure Yoga cache hit rates remain high.
   - Dogfood in sample apps with mixed primitives (Buttons, TextInputs, complex cards) to confirm event handling and layout fidelity.
3. **Documentation & Rollout**
   - Document the new architecture, template lifecycle, and any debugging hooks (cache stats, logging flags).
   - Ship behind a feature flag if needed, then gradually enable for Android once stability/perf goals are met.

## Additional Considerations
- **Memory Management:** Ensure template nodes and cached layouts are released promptly when data changes to avoid leaks.
- **Event Throughput:** Because events flow through real host nodes, confirm RecyclerView recycling does not drop press/scroll events under heavy load.
- **Backward Compatibility:** Provide escape hatches (e.g., prop to opt out) for scenarios where apps must temporarily stay on the ScrollView-based FlatList during rollout.
