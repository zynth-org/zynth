# Virtual List Recorder Limits

## Why the Recorder Exists

VirtualList items do not mount directly into the Android `RecyclerView`. Instead, the Solid component tree is "recorded" into a lightweight JSON snapshot and passed across the bridge. On the native side, `RuneVirtualListView` rebuilds the tree with Android primitives and runs Yoga to measure them. The recorder captures exactly what should be rendered so we can:

- Avoid mounting hundreds of off-screen DOM nodes.
- Re-run Yoga layout quickly without re-rendering Solid.
- Cache item structures and reuse them during fast scrolls.

Because the recorder is the only source of truth for the native renderer, every component that appears inside `renderItem` must serialize itself into the `VirtualNode` format.

## What Works Today

`View` and `Text` already understand the recorder. When a VirtualList is recording, these primitives call `getVirtualListRecorder()` and produce `VirtualViewNode` and `VirtualTextNode` entries. Arbitrary JSX interpolations (strings, numbers, arrays, Solid accessors) get normalized by the recorder helpers, so basic markup works fine.

## Current Limitation

Higher-level primitives such as `Button`, `Pressable`, `Image`, etc., do not yet participate in the recorder. They render correctly outside VirtualList because they return real host views, but during recording they need to emit a serializable structure instead. Without recorder support they fall back to regular rendering, which never reaches the native virtual list, so they simply do not appear.

In short:

- VirtualList currently supports only primitives that explicitly integrate with `virtual-list-recorder.ts` (today: `View`, `Text`).
- Any component rendered inside `renderItem` must ultimately render down to those recorder-aware primitives.
- Wrapping non-recorder components in `View`/`Text` works because the outer primitive serializes the subtree, but the inner component still needs to translate its props into primitives manually.

## Why the Recorder Needs Component Awareness

The recorder sits at render time; it does not inspect already-mounted views. When `renderItem` runs, components decide how to serialize themselves. If a component does not call the recorder, there is no way to infer its shape later, and the native side would have to guess or fall back to mounting real views (defeating virtualization). Therefore each primitive must opt in so the recorder knows:

- Which type of node to emit (`view` vs `text`).
- What style props, accessibility props, and metadata to capture.
- How to normalize children (flat arrays, nested components, reactive accessors, etc.).

This tight coupling keeps the serialization fast and deterministic, which is critical for 120hz scroll perf.

## Path to Broader Component Support

The limitation is architectural but not fundamental. We can support more primitives by doing the following per component:

1. Detect when a VirtualList recording session is active using `getVirtualListRecorder()`.
2. Instead of returning a real host view, call into the recorder to emit `VirtualNode` data for that primitive.
3. Ensure nested children are serialized via the recorder helpers so they collapse to primitives as needed.
4. Provide a native implementation that understands the emitted node type (e.g., add `Image` handling to the Android/iOS VirtualList renderer).

Once each primitive participates, higher-level composites (e.g., `Button` built from `Pressable + Text`) will serialize correctly because all of their building blocks cooperate with the recorder.

## Next Steps

- Track the missing primitives (`Button`, `Pressable`, `Image`, etc.) and add recorder integration to each.
- Document how third-party components can integrate: expose a utility that wraps `withVirtualListRecorder` and handles child normalization.
- Expand the native VirtualList renderer to know how to materialize new node types (additional layout styles, images, press handlers).

Until then, VirtualList should be used with recorder-aware primitives only. This keeps virtualization predictable today while we work toward a more agnostic recorder that understands the full primitive surface area.
