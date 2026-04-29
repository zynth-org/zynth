# Android Native Renderer Migration Supplement

Date: 2026-04-29
Status: Implementation supplement for `android-rendering-hotpath.md`
Scope: `packages/zynth-core/android/ZynthKit`

## Executive Summary

The existing roadmap is correct: Android must stop treating Kotlin/Java as the commit and layout center. This supplement makes that plan concrete enough for implementation.

The migration is successful only when the Android steady-state frame path is:

```text
JS renderer update
  -> Hermes / JSI host function
  -> C++ commit preparation
  -> C++ Yoga mutation + layout calculation
  -> compact mount transaction
  -> one Java/Kotlin main-thread apply
```

Anything that still decodes most props in Kotlin, owns Yoga nodes through `com.facebook.yoga.YogaNode`, or calculates layout in `ZynthYogaLayout.kt` is not a completed native renderer migration. It may be a useful transitional optimization, but it is not the architecture we are targeting.

This is intentionally a breaking migration. Do not preserve the legacy Java Yoga path as a permanent compatibility contract. A temporary feature flag is acceptable only for bring-up, bisecting, and benchmark comparison.

## Current Reality Check

Android already has Hermes, JSI host functions, typed payloads, direct buffers, and atomic commit markers. Those pieces reduce some bridge overhead, but they do not move rendering to C++.

The current implementation still proves that rendering is Kotlin/Java-centered:

- `zynthkit.cpp` installs `__ui.applyBatchTyped`, but the packed/direct-buffer payload is forwarded to `ZynthUIManager.applyBatchTypedPacked(...)` or `ZynthUIManager.applyBatchTypedBuffer(...)`.
- `ZynthUIManager.applyBatchTypedPacked(...)` and `applyBatchTypedBuffer(...)` decode opcodes in Kotlin and call `setProp`, `setText`, `insertChild`, `removeChild`, and `dropNode` one operation at a time.
- `ZynthUIManager.setProp(...)` still resolves layout props, scales dp to px, updates `yogaStyleCache`, mutates Yoga, mutates views for non-layout props, calls descriptor hooks, and marks dirty surfaces.
- `ZynthYogaLayout.kt` owns Java `YogaNode` objects, mutates style through string dispatch, calls `rootNode.calculateLayout(...)`, walks changed nodes, applies Android view frames, and can slice frame application across multiple passes.
- `ZynthUIManagerScheduler.kt` coordinates dirty surfaces, adaptive layout budgets, over-budget logging, style/layout event phases, and layout completion state around Kotlin-owned layout.
- Android Gradle currently depends on `com.facebook.yoga:yoga`, and CMake links Hermes, ReactAndroid JSI, fbjni, and log, but not a native Yoga target.

The phrase "C++ renderer" should therefore be reserved for the future state where C++ owns the commit graph, node tree, Yoga nodes, dirty state, layout calculation, frame diff, and transaction emission.

## Non-Negotiable Architecture Invariants

1. C++ owns renderer state.

The authoritative state for node identity, parent/child relationships, layout props, Yoga node lifecycle, dirty layout state, and latest calculated frames must live in C++. Kotlin may hold platform view objects and component descriptor state, but it must not be the primary renderer model.

2. Kotlin applies transactions; it does not interpret commits.

The main-thread Kotlin API should receive a prepared transaction that says what platform work to perform. It should not loop over typed renderer ops and decide whether a property is layout, visual style, text, pointer events, or a descriptor callback.

3. Java Yoga is removed from the steady-state hot path.

`ZynthYogaLayout.kt` can exist temporarily during migration, but the new default path must not call Java `YogaNode` APIs for normal layout.

4. A logical commit normally produces one layout calculation and one apply pass.

The current budgeted slicing protects against worst-case stalls, but it also spreads one logical commit across frames. The native path should reserve slicing for pathological fallback only, not normal VirtualList or navigation commits.

5. Measurement is explicit and cached.

Text/intrinsic measurement can cross to Android because platform text measurement is platform work. That crossing must be narrow, cacheable, reason-tagged, and visible in telemetry. It must not become an implicit return to Java-driven layout.

6. No framework logic moves into `apps/**`.

Benchmarks may live in apps, but renderer logic, migration switches, APIs, and validation hooks belong in `packages/zynth-core`.

7. No `any`, no production `console.log`, no React patterns.

This migration is runtime/native-heavy, but the package standards still apply. Public JS/TS types must stay strict and documented.

## Target Module Layout

Add focused C++ units instead of expanding `zynthkit.cpp` indefinitely:

```text
packages/zynth-core/android/ZynthKit/src/main/cpp/
  ZynthRendererHost.h/.cpp
  ZynthCommit.h/.cpp
  ZynthCommitDecoder.h/.cpp
  ZynthProp.h/.cpp
  ZynthYogaTree.h/.cpp
  ZynthMeasureRegistry.h/.cpp
  ZynthMountTransaction.h/.cpp
  ZynthRendererTelemetry.h/.cpp
```

Suggested responsibilities:

- `ZynthRendererHost`: runtime-scoped owner that connects Hermes/JSI, renderer state, JNI apply calls, and telemetry.
- `ZynthCommit`: immutable or append-only per-batch native commit artifact.
- `ZynthCommitDecoder`: decodes the typed op buffer and string table into native records.
- `ZynthProp`: stable prop enum, type tags, unit tags, parser/normalizer, and layout-vs-view classification.
- `ZynthYogaTree`: C++ Yoga config, node pool, surface roots, dirty state, tree mutation, layout calculation, frame diffing.
- `ZynthMeasureRegistry`: native measure callbacks, text measurement cache keys/results, dirty reasons.
- `ZynthMountTransaction`: compact platform transaction records for create/delete/reparent/view props/layout frames/events.
- `ZynthRendererTelemetry`: phase timers, counters, trace serialization, and benchmark summary snapshots.

Keep `zynthkit.cpp` as the integration shell: install host functions, own runtime state, and dispatch to the renderer host.

## Native Data Model

Use compact enums and typed records. Do not store prop names as hot-path strings after decode.

```cpp
enum class ZynthOpCode : uint8_t {
  SetProp = 1,
  SetText = 2,
  InsertChild = 3,
  RemoveChild = 4,
  DropNode = 5,
  CreateNode = 6,
  SetSurface = 7,
};

enum class ZynthPropId : uint16_t {
  Width,
  Height,
  MinWidth,
  MinHeight,
  MaxWidth,
  MaxHeight,
  Flex,
  FlexGrow,
  FlexShrink,
  FlexBasis,
  Top,
  Right,
  Bottom,
  Left,
  Padding,
  PaddingHorizontal,
  PaddingVertical,
  PaddingTop,
  PaddingRight,
  PaddingBottom,
  PaddingLeft,
  Margin,
  MarginHorizontal,
  MarginVertical,
  MarginTop,
  MarginRight,
  MarginBottom,
  MarginLeft,
  Gap,
  RowGap,
  ColumnGap,
  AspectRatio,
  FlexDirection,
  JustifyContent,
  AlignItems,
  AlignSelf,
  AlignContent,
  FlexWrap,
  Position,
  Display,
  Overflow,
  Background,
  BackgroundImage,
  BackgroundColor,
  BorderColor,
  BorderStyle,
  BorderRadius,
  BorderWidth,
  Color,
  FontSize,
  FontWeight,
  FontFamily,
  FontStyle,
  TextAlign,
  Opacity,
  Elevation,
  ZIndex,
  Transform,
  PointerEvents,
  AccessibilityLabel,
  LayoutTransition,
  ComponentSpecific,
};

enum class ZynthValueKind : uint8_t {
  Null,
  Number,
  Bool,
  String,
  Percent,
  Auto,
  JsonString,
};

struct ZynthPropValue {
  ZynthValueKind kind;
  double number;
  uint32_t stringIndex;
};

struct ZynthPropMutation {
  int32_t nodeId;
  ZynthPropId prop;
  ZynthPropValue value;
};

struct ZynthLayoutFrame {
  int32_t nodeId;
  float left;
  float top;
  float width;
  float height;
  uint8_t changed;
};
```

Implementation guidance:

- Preserve the existing negative key-token fast path, but decode it in C++.
- Generate or centralize the prop-token table so JS, C++, and any Kotlin fallback cannot drift.
- Normalize dp-to-px in C++ using the density supplied by Kotlin during renderer host creation.
- Represent layout values as points/pixels/percent/auto explicitly. Do not bounce through strings like `"12.0"` for layout props.
- Store component-specific or unknown props separately so they can be forwarded to Kotlin descriptors in batches without slowing the layout prop path.

## JNI Boundary Shape

Replace high-frequency JNI methods with coarse renderer APIs. Kotlin should expose a small apply surface, roughly:

```kotlin
internal fun createPlatformView(nodeId: Int, type: String, surfaceId: Int)

internal fun applyMountTransaction(
  transactionId: Long,
  creates: IntArray,
  deletes: IntArray,
  reparentOps: IntArray,
  layoutFrames: FloatArray,
  viewProps: ByteBuffer,
  layoutEvents: FloatArray,
  telemetry: ByteBuffer,
)
```

The exact packing can change, but the boundary must stay coarse:

- One JNI call to submit a JS commit into native, ideally directly from JSI without first copying into Kotlin arrays.
- One JNI call to ask Kotlin to create platform views for node types that require Android `View` instances.
- One JNI call to apply the prepared mount/layout transaction on the main thread.
- Event dispatch remains explicit and batched.

Avoid these boundary shapes in the final path:

- `setProp(id, name, value)` as a renderer hot-path primitive.
- `insertChild(parentId, childId, index)` as an immediate layout/tree mutation.
- `applyBatchTypedPacked(DoubleArray, Array<String?>)` as the default renderer entry.
- Per-node `frame(id)` calls after layout.

## Commit Pipeline

The native renderer host should process a batch like this:

1. `__ui.applyBatchTyped(payload)` enters C++ from Hermes.
2. C++ validates payload shape and obtains the typed op buffer plus string table.
3. `ZynthCommitDecoder` decodes all ops into a native `ZynthCommit`.
4. `ZynthCommit` records structure mutations, prop mutations, text mutations, event handler changes, and surface switches without touching platform views.
5. `ZynthRendererHost` applies the commit to native renderer state.
6. `ZynthYogaTree` mutates native Yoga nodes for layout-affecting changes and records dirty reasons.
7. `ZynthYogaTree` calculates layout for dirty surfaces with current root constraints.
8. Native code diffs calculated frames against previous frames.
9. `ZynthMountTransaction` is built with create/delete/reparent operations, final frames, view props, text updates, and layout events.
10. Kotlin applies the transaction on the main thread.
11. JS layout events are flushed after the transaction boundary, not midway through partial application.

The implementation agent should delete or bypass code that contradicts this pipeline after parity is proven.

## Surface And Node Ownership

Native state should contain:

```cpp
struct ZynthNodeRecord {
  int32_t id;
  int32_t parentId;
  int32_t surfaceId;
  uint16_t typeId;
  uint8_t hasMeasureFunc;
  uint8_t emitsLayout;
  YGNodeRef yoga;
  std::vector<int32_t> children;
  ZynthLayoutFrame lastFrame;
};

struct ZynthSurfaceRecord {
  int32_t surfaceId;
  int32_t rootNodeId;
  float width;
  float height;
  YGNodeRef rootYoga;
  uint64_t lastCommitId;
};
```

Rules:

- Surface root constraints come from Kotlin/Android view size, but they are inputs to C++ layout.
- Moving a subtree to another surface updates native ownership first, then emits one platform reparent transaction.
- Native children order is authoritative for Yoga and mount order.
- Kotlin may still reorder platform children for z-index, but z-index sorting should be driven by transaction data rather than recomputing from scattered style maps.

## Prop Classification

Split props into four classes during C++ decode:

1. Layout props.

These mutate C++ Yoga immediately as part of commit application: dimensions, flex, position, padding, margin, gap, aspect ratio, display, overflow, alignment, direction, wrap.

2. View props.

These do not affect Yoga and can be packed for Kotlin transaction apply: opacity, transform, background, border, shadow, pointer events, accessibility, test ID, z-index, elevation.

3. Text/intrinsic props.

These affect Android text/content measurement and may dirty Yoga through a measured node: text value, font size, line height, letter spacing, font family, font weight, text transform, number of lines, editable/input state.

4. Component descriptor props.

These are component-specific hooks. Keep them out of the generic layout path. Batch them by node and descriptor type for Kotlin apply.

Important correction: a prop being parsed from a typed payload does not mean it is native-renderer-ready. It is native-renderer-ready only when its classification and normalized value are consumed without string dispatch in Kotlin.

## Native Yoga Requirements

The C++ path must use native Yoga APIs and own Yoga node memory directly.

Tasks:

- Add native Yoga headers/library access to Android CMake.
- Create one `YGConfigRef` per renderer host or compatible shared config.
- Create one Yoga root per surface.
- Pool `YGNodeRef` objects only after correctness is stable. Start with clear ownership and deterministic free paths.
- Map every layout prop currently supported in `ZynthYogaLayout.kt` to a native typed setter.
- Implement dimension parsing once: number, percent, auto, undefined/null.
- Set measure functions only for nodes that truly need intrinsic measurement.
- Track dirty reasons before optimizing dirty propagation.
- Produce all layout frames in one pass after `YGNodeCalculateLayout`.

Native Yoga acceptance criteria:

- `ZynthYogaLayout.kt` is not called for default layout.
- `com.facebook.yoga.YogaNode` does not appear in the default renderer stack.
- Layout timing can report native Yoga calculate time separately from Android transaction apply time.
- The Java Yoga dependency is either removed or kept only while a flagged legacy path exists.

## Text And Intrinsic Measurement

Text is the migration trap. Solve it deliberately rather than allowing it to pull layout ownership back into Kotlin.

Measurement contract:

- C++ Yoga measure function receives constraints.
- C++ builds a `MeasureRequest` containing node id, width, width mode, height, height mode, and a content/style revision.
- The request is resolved through a narrow JNI callback into Kotlin only when the native measurement cache misses.
- Kotlin measures Android `TextView` or descriptor-specific intrinsic content and returns width/height.
- C++ caches the result by stable key and records telemetry for hit/miss/dirty reason.

Dirty reasons should include:

- `TextContentChanged`
- `FontFamilyChanged`
- `FontSizeChanged`
- `FontWeightChanged`
- `LineHeightChanged`
- `LetterSpacingChanged`
- `WidthConstraintChanged`
- `NumberOfLinesChanged`
- `DescriptorMeasureInvalidated`
- `SurfaceConstraintChanged`

VirtualList variable-height rows should be used as the primary text measurement benchmark because it is the workload most likely to hide a layout ownership regression.

## Mount Transaction Format

The transaction should be compact and append-only during construction.

Recommended record groups:

- `creates`: node id, type id, surface id.
- `deletes`: node id.
- `reparents`: parent id, child id, index, surface id.
- `layoutFrames`: node id, left, top, width, height, changed bit.
- `viewProps`: typed visual/text/descriptor props grouped by node.
- `layoutEvents`: node id, x, y, width, height.
- `firstFrameSignals`: surface ids that became visible.
- `telemetry`: commit id and phase counters.

Kotlin apply rules:

- Apply deletes before creates only when it prevents duplicate parentage; otherwise use deterministic transaction order.
- Create all missing platform views before reparenting.
- Apply reparent operations before final frame layout.
- Apply text/content props before layout if they affect native view state needed by rendering, but after native measurement has already been resolved for the commit.
- Apply frames with `view.layout(left, top, right, bottom)` using final native-calculated values.
- Emit layout events after frame application completes.

The main thread should be boring. If it feels like a renderer, the migration is drifting.

## Telemetry Required Before And During Migration

Add phase timers that survive both old and new paths:

- `jsBatchBuildMs`
- `jsiEntryMs`
- `nativeDecodeMs`
- `nativeCommitApplyMs`
- `nativeYogaMutateMs`
- `nativeYogaCalculateMs`
- `measureCallbackMs`
- `measureCacheHitCount`
- `measureCacheMissCount`
- `jniTransactionBuildMs`
- `mainThreadTransactionApplyMs`
- `layoutEventDispatchMs`
- `commitToApplyLatencyMs`
- `commitToPresentLatencyMs`
- `dirtySurfaceCount`
- `mutatedNodeCount`
- `layoutNodeCount`
- `changedFrameCount`
- `viewPropMutationCount`
- `applyPassCount`

Use one commit id across all phases. Without a commit id, frame-sliced or delayed work will continue to look like random frame noise.

Benchmark gates:

- VirtualList variable-height scrolling.
- VirtualList insert/remove churn.
- BottomTabs initial screen load.
- BottomTabs navigation commit.
- Text-heavy list with font/style changes.
- Surface switch/subtree move.

Do not declare success from total frame time alone. A release build can hide architecture problems. Success requires showing that time moved out of Kotlin interpretation and Java Yoga.

## Implementation Phases

### Phase 0: Instrument And Freeze The Baseline

Objective: prove the current cost centers before rewriting them.

Tasks:

- Add commit ids to the current typed batch path.
- Time C++ JSI entry and typed payload extraction.
- Time Kotlin typed decode separately from `setProp` execution.
- Time layout prop handling, view prop handling, descriptor handling, and text handling separately inside Kotlin.
- Time `ZynthYogaLayout.layout(...)`, `rootNode.calculateLayout(...)`, and `applyPending(...)` separately.
- Count apply slices and carry commit id across slices.
- Emit one benchmark summary line per commit in debug/profile builds only.

Exit criteria:

- The team can point to exact milliseconds for Kotlin decode, Kotlin prop interpretation, Java Yoga calculate, frame apply, measurement, and event dispatch.

### Phase 1: Native Commit Decoder

Objective: stop decoding renderer operations in Kotlin.

Tasks:

- Implement `ZynthCommitDecoder`.
- Decode direct `ArrayBuffer` payloads in C++ without converting to `DoubleArray`.
- Decode the string table once and keep string references scoped to the commit.
- Convert known prop tokens to `ZynthPropId`.
- Emit unknown/component props into a secondary component-prop section.
- Keep output inspectable in debug builds.
- Add a temporary flag: old Kotlin decode vs native decode with Kotlin apply.

Exit criteria:

- `applyBatchTypedPacked(...)` and `applyBatchTypedBuffer(...)` are no longer the default path for typed commits.
- C++ can report op counts and prop classes before Kotlin sees the transaction.

### Phase 2: Native Renderer State And Node Tree

Objective: make C++ the authoritative owner of node/surface topology.

Tasks:

- Add `ZynthRendererHost` to `RuntimeState`.
- Move node records, parent/child lists, surface ids, and dirty surfaces into C++.
- Route create/drop/insert/remove/setSurface through native state.
- Keep Kotlin platform view maps, but make them mirrors of native transaction output.
- Add debug assertions comparing native child order to platform child order after apply.

Exit criteria:

- Native state can print a full renderer tree without asking Kotlin.
- Kotlin no longer owns the authoritative `parents`, `children`, `nodeSurfaces`, or dirty surface decision for the new path.

### Phase 3: Native Yoga Ownership

Objective: remove Java Yoga from the default layout path.

Tasks:

- Link native Yoga into CMake.
- Implement `ZynthYogaTree`.
- Port every layout setter from `ZynthYogaLayout.kt` to typed C++ setters.
- Create Yoga nodes from native node records.
- Implement subtree moves and surface root attachment.
- Calculate layout in C++ for dirty surfaces.
- Emit frame diffs into `ZynthMountTransaction`.
- Keep the Java path only under a temporary validation flag.

Exit criteria:

- Default Android layout calls native Yoga, not `ZynthYogaLayout.layout(...)`.
- Frame diffs are produced before the main-thread apply.

### Phase 4: Kotlin Transaction Apply

Objective: make Kotlin a platform mount executor.

Tasks:

- Add `applyMountTransaction(...)`.
- Batch create/delete/reparent/layout/view-prop operations.
- Remove normal per-op calls from the new commit path.
- Apply final frames in one pass for normal commits.
- Flush layout events after transaction completion.
- Preserve component descriptors by batching descriptor props and lifecycle callbacks.

Exit criteria:

- One logical commit normally maps to one Kotlin apply call.
- Main-thread apply time is separately measurable and does not include prop classification or Yoga calculation.

### Phase 5: Text Measurement And Intrinsic Views

Objective: keep variable-height and text-heavy workloads fast.

Tasks:

- Implement native measurement cache.
- Add JNI measurement callback only for cache misses.
- Add content/style revisions for text nodes.
- Move text dirtying to explicit dirty reasons.
- Validate Android text results against current behavior and iOS expectations.

Exit criteria:

- VirtualList variable-height rows do not regress.
- Measurement miss spikes are visible and explainable.

### Phase 6: Remove Legacy Hot Path

Objective: make the migration real, not dual-renderer archaeology.

Tasks:

- Delete or quarantine old typed Kotlin decode.
- Remove Java Yoga default dependency if no remaining feature needs it.
- Remove duplicate style parsing and `yogaStyleCache` from the default path.
- Keep debug snapshot support by reading native state, not by depending on Kotlin as source of truth.
- Update docs and comments to name C++ as renderer owner.

Exit criteria:

- A code search for default renderer flow does not find Java Yoga layout, per-prop Kotlin commit interpretation, or normal multi-slice apply.

## Compatibility Policy

This migration is allowed to break previous internal behavior.

Allowed temporary compromises:

- A runtime flag for old vs new path.
- Dual telemetry for baseline comparison.
- Kotlin fallback for component-specific props.
- Java Yoga path for short-lived parity verification.

Not allowed as final architecture:

- A permanent mixed tree where some nodes are Java Yoga and some are C++ Yoga.
- Kotlin deciding layout-vs-view prop classification in normal commits.
- Calling `setProp` once per prop from C++ after decoding a native transaction.
- Keeping multi-frame slicing as the normal solution for VirtualList-sized commits.
- Measuring text by letting Kotlin own layout.

## False-Positive Checklist

Use this checklist before accepting any claim that rendering moved to C++:

- Does C++ own every Yoga node in the default Android path?
- Does C++ call Yoga layout calculation directly?
- Does Kotlin receive final frames rather than calculating/walking Yoga frames?
- Does a commit cross JNI as a coarse transaction rather than many per-prop calls?
- Are layout props represented as enums/typed values after decode?
- Can telemetry separate native decode, native Yoga, main-thread apply, and event dispatch?
- Can the Java Yoga path be disabled without breaking the target benchmarks?
- Does VirtualList avoid normal multi-frame apply slicing?
- Can C++ print the renderer tree and dirty surfaces without reading Kotlin maps?
- Are text measurement misses explicit and counted?

If any answer is "no", the migration is incomplete.

## Acceptance Targets

Performance targets should be revisited after baseline instrumentation, but the initial bar should be aggressive enough to prevent cosmetic wins:

- VirtualList variable-height design/layout pass should move materially closer to iOS and stop living in the `5-8ms` normal range for representative workloads.
- Normal VirtualList scroll commits should leave enough headroom for 120fps-class frame budgets on modern devices.
- BottomTabs screen/navigation commits should complete as one logical native transaction in normal cases.
- Main-thread transaction apply should become mostly proportional to changed platform views, not total decoded props.
- Java/Kotlin prop interpretation should no longer dominate commit time.

Functional targets:

- Surface creation, unregister, and subtree moves remain deterministic.
- Layout events fire once per final committed frame.
- Text measurement and intrinsic sizing remain visually correct.
- Component descriptors continue to receive required lifecycle/property callbacks, but outside the generic layout hot path.
- SolidJS fine-grained update semantics remain unchanged because the JS renderer contract still batches host mutations into `__ui.applyBatchTyped(...)`.

## Files To Change First

Start here:

- `packages/zynth-core/android/ZynthKit/src/main/cpp/zynthkit.cpp`
- `packages/zynth-core/android/ZynthKit/CMakeLists.txt`
- `packages/zynth-core/android/ZynthKit/build.gradle.kts`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManager.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerScheduler.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerSurface.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerStyle.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/layout/ZynthYogaLayout.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/runtime/JSBridge.kt`

Reference for behavioral parity:

- `packages/zynth-core/ios/ZynthKit/include/ZynthNode.h`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthYogaLayout.m`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager.m`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager+Scheduler.m`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager+Surface.m`

## Implementation Order For The Next Agent

1. Add telemetry and commit ids to the current path.
2. Add C++ files and wire a `ZynthRendererHost` into `RuntimeState`.
3. Move typed commit decode to C++ and keep Kotlin apply temporarily.
4. Move node/surface topology ownership to C++.
5. Link native Yoga and port layout setters.
6. Build native layout frame diffs.
7. Add coarse Kotlin mount transaction apply.
8. Add text measurement cache/callback and dirty reasons.
9. Run the two required benchmark families after every phase: VirtualList variable-height and BottomTabs navigation/screen load.
10. Remove the old Java Yoga path once the target scenarios are stable.

## Final Definition Of Done

The migration is done when Android's default renderer can be truthfully described as:

```text
JS -> Hermes/JSI -> C++ commit -> C++ Yoga layout -> Kotlin platform mount transaction
```

and not as:

```text
JS -> Hermes/JSI -> C++ forwarding -> Kotlin op decode -> Java Yoga -> Kotlin frame slicing
```

That distinction is the whole project. Guard it carefully.
