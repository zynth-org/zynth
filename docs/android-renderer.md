# Android Renderer (RuneKit) — Architecture, Batching, and Performance

This document describes how Rune renders UI on Android (RuneKit), how the JavaScript bridge batches mutations, how layout/commit works with Yoga, and what performance/stability safeguards exist.

It’s written as a “mental model” + troubleshooting guide so you can reason about behavior (especially with `rune-screens` / tab surfaces) and evaluate performance changes.

## High-Level Mental Model

Rune’s Android renderer is a **two-phase pipeline**:

1. **JS mutation phase (Hermes / JS):** create nodes, set props/text/handlers, insert/remove children. These operations are *queued* and frequently **batched** before crossing the bridge.
2. **Native commit phase (UI thread):** apply queued native mutations, apply view hierarchy changes, run Yoga layout, then apply frames to Android `View`s in one commit.

The key invariants:

- **No intermediate frames** should be visible while a commit is in progress (prevents flashes/FOUC).
- **View tree operations and prop/text operations must be ordered consistently** so nodes aren’t removed before their final mutations are applied.
- **Surfaces are isolated UI trees** with their own Yoga trees and operation queues; switching “active surface” must not redirect operations to the wrong surface.

## Key Concepts

### Nodes

Rune maintains a `Node` object per UI element:

- `id`, `type`, and the backing Android `View`
- parent/children relationships (tracked in native)
- text bookkeeping (virtual text merging, cached text)
- mount gating flags used to avoid showing unstyled nodes

### Yoga Layout

Yoga is used to compute layout frames (`x/y/width/height`), which are then applied to `View.layout(...)` with `FrameLayout.LayoutParams`.

Yoga details:

- Each surface gets its own `YogaLayoutEngine` with a per-surface root node.
- `engine.calculateLayout(rootWidth, rootHeight)` runs once per commit iteration.
- Frames are fetched in bulk via `engine.getAllFrames()` to reduce per-node JNI overhead.

### Surfaces

Surfaces are separate render roots used for things like tab icons and routed screens:

- Each surface owns its own:
  - `SparseArray<Node>`
  - pending queues (`pendingNativeOperations`, `pendingViewOperations`, `pendingTextRebuild`)
  - `YogaLayoutEngine`
  - `RuneLayoutFlush` (commit pipeline)
  - `FrameCommitCoordinator` (frame gating)
- Surfaces are registered via `RuneUIManager.registerSurface(surfaceId, RuneRootView)`; each one mounts into a dedicated container view (`RuneRootView.contentView`).

Why surfaces matter for correctness:

- Tabs often update multiple surfaces quickly; relying on a single global “active surface” can misroute work.
- Rune tracks `nodeId → surfaceId` so operations are applied to the surface that owns the node, not whichever surface is currently active.

## The JS → Native Batching Model

The JS host coalesces operations and sends them over the bridge using `ui.applyBatch(...)` when available. A batch is a JSON payload:

```json
{
  "meta": { "kind": "...", "scope": "..." },
  "operations": [
    { "type": "createNode", "nodeId": 123, "tag": "view" },
    { "type": "setProp", "nodeId": 123, "name": "style", "value": "{...}" },
    { "type": "insertChild", "parentId": 0, "childId": 123, "index": 0 }
  ]
}
```

Native receives this in `RuneUIManager.applyBatch(...)` and routes each op to the same code paths as individual bridge calls (`createNode`, `setProp`, `setText`, `insertChild`, `removeChild`), ensuring:

- consistent surface routing
- consistent queueing
- consistent scheduling of a flush

## Native Commit Pipeline (Flush)

All commits happen on the **main/UI thread** via `RuneLayoutFlush`.

### Phases

Each flush iteration typically runs:

1. **Process native ops** (`pendingNativeOperations`):
   - batched style/layout props are accumulated and applied
   - text updates are staged
   - handler updates are registered
2. **Process view ops** (`pendingViewOperations`):
   - inserts/removes are applied to parent `ViewGroup`s with layout suppression
   - *important:* node destruction is deferred until commit-time (see Stability section)
3. **Drain text rebuilds**:
   - rebuild composed text for nested/virtual text
   - mark Yoga dirty when needed
4. **Yoga layout**:
   - `engine.calculateLayout(...)`
5. **Apply frames**:
   - update layout params / measure / `layout(...)`
   - apply visibility gating (frame size + mount gating)

Flush iterations can repeat if new work is queued during commit (capped with a small max).

## Frame Gating (Preventing Incomplete Frames)

Rune uses a per-surface gating mechanism to avoid drawing “half applied” UI.

### Default behavior (non-blocking)

Instead of canceling `OnPreDraw` (which can freeze unrelated animations in the window), Rune gates at the **surface content container**:

- Each `RuneRootView` contains a `contentView` where Rune mounts views.
- The surface `contentView` starts `INVISIBLE` and is revealed after the first usable frame for that surface.

### Configuration

These are runtime properties (set via `System.setProperty(...)` or your build/runtime environment):

- `rune.frameBarrier.mode`
  - `hide` (default): hide surface content during commit (non-blocking)
  - `predraw`: install `OnPreDrawListener` and cancel draw while committing (blocking)
  - `off`: disable commit barrier
- `rune.frameBarrier.scope`
  - default: barrier only until a surface’s first frame is committed
  - `always`: barrier on every commit (strongest consistency, most intrusive)
  - `off`: never use the barrier
- `rune.mount.hideTimeoutMs` (default `120`)
  - hides newly inserted nodes briefly if they were inserted before their first visual props arrive (reduces FOUC)

## Stability Improvements (Why Tab Icons/Surfaces Became Reliable)

Two changes matter most:

### 1) Per-surface routing is now deterministic

Operations are applied to the surface that owns the node (via `nodeId → surfaceId`), rather than depending on the currently active surface. This prevents intermittent “node not found” for tab icon nodes when multiple surfaces are updating.

### 2) Node destruction is deferred to commit-time

Previously, `removeChild()` could remove nodes from the native registry immediately. If the same JS batch later issued `setText`/`setProp` for that node ID (still within the same microtask-flush), native would observe a missing node and drop the update, producing:

- blank UI
- `setText: node … not found`
- view detach warnings

Now:

- `removeChild()` only enqueues a remove operation.
- The node is destroyed **during flush**, after the view is detached, so other queued ops in the same batch can still apply.

This matches the “transaction commit” behavior you expect from React Native-like renderers.

## Performance Notes

Where time goes in a flush:

- applying props (especially style parsing + background/shadow work)
- `ViewGroup` inserts/removes (layout suppression helps)
- Yoga layout
- applying frames + measuring (especially if a lot of nodes re-measure)

Existing optimizations:

- `applyBatch` coalesces multiple ops into fewer JNI crossings
- batched style/layout property application reduces repeated `engine.setStyle()` calls
- bulk frame fetch via `getAllFrames()`

Recommended profiling approach:

- enable Rune’s perf logs for flush iteration timing (`rune.router.perfLogs=1`)
- look for large numbers of:
  - view ops per commit
  - repeated iterations per flush
  - many nodes being measured each commit

## Troubleshooting Checklist

If you see blank surfaces, missing icons, or “random” UI:

1. Check for `setText: node … not found` or `setProp: node … not found` logs.
   - This usually indicates an ordering issue (node destroyed before commit) or surface misrouting.
2. Check surface logs:
   - `registerSurface`, `setActiveSurface`, `insertChild` should reference the expected `surfaceId`.
3. Temporarily disable gating to isolate:
   - `rune.frameBarrier.mode=off`
   - If the bug disappears, you likely have a commit lifecycle bug (first-frame gating vs barrier restore).
4. If animations freeze:
   - Ensure you’re not using `rune.frameBarrier.mode=predraw` globally.

## File Map (Where to Look)

- `packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/core/RuneUIManager.kt`
  - surface registration, op routing, batching entry (`applyBatch`), bridge methods
- `packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/core/RuneLayoutFlush.kt`
  - the commit pipeline (native ops, view ops, Yoga, frame apply)
- `packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/layout/YogaLayoutEngine.kt`
  - Yoga node management and style application
- `packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/core/FrameCommitCoordinator.kt`
  - commit barrier modes and surface visibility gating
- `packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/core/RuneRootView.kt`
  - `contentView` container + debug overlay

