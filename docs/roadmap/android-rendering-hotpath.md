# Android Rendering Hotpath Refactor Roadmap

Date: 2026-04-19
Status: Draft for long-term native renderer refactor
Scope: `packages/zynth-core/android/ZynthKit`

Supplement: `docs/roadmap/android-native-renderer-migration-supplement.md`

## Purpose

This document captures a real refactor plan for Android rendering performance, focused on reducing the gap between:

- iOS Zynth runtime behavior today
- Android Zynth runtime behavior today
- Modern commit-based native architectures

The goal is not a cosmetic optimization pass. The goal is to change the Android hotpath architecture so layout and mount work are computed, committed, and applied with much less Kotlin/JNI churn and much tighter frame coherence.

## Problem Statement

Current results show a major platform gap:

- iOS VirtualList workloads with variable-height items can stay around `0.12ms`, with rare spikes around `0.80ms` even under extreme scrolling.
- iOS larger structural commits such as BottomTabs screen loads often stay around `1-2ms`.
- Android needs a production APK and HBC just to keep many of the same workloads under roughly `14ms`.
- Android VirtualList workloads often land around `4-7ms`.
- Android BottomTabs screen loads often land around `7ms` or higher.

This is too large to treat as simple tuning noise. The Android renderer currently does many of the right things already:

- Hermes
- JSI host functions
- Typed batch payloads
- Reduced prop serialization
- Re-measurement fixes

Those wins matter, but they do not remove the core architectural mismatch.

## Current Android Hotpath

Today’s Android path is broadly:

1. JS builds typed ops and calls `__ui.applyBatchTyped(...)`.
2. C++/JNI forwards that payload into `ZynthUIManager`.
3. `ZynthUIManager` decodes the ops and executes them one by one on the main thread.
4. Each `setProp` call mutates Yoga or Android views immediately in Kotlin.
5. Dirty surfaces are scheduled through `Choreographer`.
6. `ZynthYogaLayout.layout(...)` runs Yoga in Java and then applies view frames incrementally with a time budget.
7. Layout events are emitted back into JS after the frame work finishes.

Important characteristics of the current implementation:

- Typed ops are already present, but commit work still fans out into many Kotlin method calls and branches.
- `setProp` performs per-prop parsing, dp scaling, style caching, Yoga mutation, view mutation, and dirty marking inline.
- `runOnMain` uses a general-purpose queue/drain model before layout is even reached.
- `ZynthYogaLayout.layout(...)` can split frame application across multiple slices when the apply budget is exceeded.
- Atomic commit exists, but it still ends in the same Kotlin-driven layout/apply model.

## Why Android Is Still Slow

The main issue is not that Android still uses a bridge. The main issue is that Android still performs too much hot work after the JSI boundary.

### Category 1: Commit fragmentation

The hotpath is fragmented across:

- C++ payload decoding
- JNI calls
- Kotlin op decoding
- Kotlin per-prop dispatch
- Java Yoga node mutation
- Android view mutation
- Frame-budgeted apply passes

This means the typed payload avoids one class of overhead while the real commit cost remains spread across several others.

### Category 2: Per-prop Kotlin work in the hotpath

`ZynthUIManager.setProp(...)` is still doing too much work per property:

- style-key resolution
- numeric/string branching
- dp-to-px conversion
- Yoga mutation
- style cache updates
- descriptor callbacks
- dirty-surface bookkeeping

This is good framework code, but it is not a minimal hotpath.

### Category 3: Java Yoga as the commit center

Yoga is still owned and mutated from the Kotlin/Java layer. That creates two problems:

- the commit representation is not compact
- layout application cannot be prepared as a native commit artifact before the main-thread apply phase

This is the opposite of a pre-computed native direction where most of the expensive tree and layout reasoning happens before the final platform mount step.

### Category 4: Frame slicing reduces worst-case stalls but adds commit latency

`ZynthYogaLayout.applyPending(...)` can intentionally spread layout application across slices using a budget. That protects the main thread from a single large stall, but it also means one logical commit can leak across multiple frames.

That tradeoff is reasonable for damage control, but it is not how we should want the steady-state hotpath to behave.

### Category 5: Main-thread work is not sufficiently precomputed

The main thread is still the place where too many decisions are made instead of merely applying an already-computed commit:

- prop normalization
- Yoga mutation
- node tree updates
- some measure wiring
- frame diff/application decisions

On iOS, the overall pipeline is still simple, but it is materially tighter and less fragmented.

## Current iOS Advantage

The iOS renderer is not magic, but it benefits from a tighter execution shape:

- simpler scheduler path
- less JNI-equivalent overhead
- less platform-side branching during commit
- tighter UIKit + Yoga integration

The important lesson is not “copy iOS line by line.” The lesson is:

- Android needs a commit architecture that is just as compact
- Android should stop treating Kotlin as the place where most commit interpretation happens

## Non-Goals

- Do not chase micro-optimizations first.
- Do not rewrite `zynth-ui`.
- Do not introduce heavyweight reconciliation models.
- Do not move app-specific logic into `apps/**`.
- Do not add external npm dependencies to solve native renderer architecture.
- Do not keep the current architecture and only “optimize around the edges.”

## Target Architecture

Android should move toward a three-stage model:

1. **Prepare Commit in C++/JSI**
   - Decode typed ops into compact native structures.
   - Normalize props once.
   - Build mount/layout mutations as native commit data, not as immediate Kotlin work.

2. **Calculate Layout in Native**
   - Own Android Yoga nodes from C++.
   - Run layout calculation before the platform apply phase.
   - Produce a final layout/mount transaction for the frame.

3. **Apply Commit on Main Thread**
   - Main thread should mostly mount/update/remove views and apply final frames.
   - Avoid per-prop interpretation during apply.
   - Avoid multi-frame slicing for normal commits; reserve fallback slicing for pathological commits only.

This does not require copying existing architectures completely, but it does require adopting the same core idea:

- compute first
- commit second
- apply last

## Refactor Themes

### Theme A: Separate mutation recording from mutation application

Today, `setProp` often means “interpret and apply immediately.” The refactor should turn that into:

- record mutation
- normalize once
- apply later as part of a frame transaction

### Theme B: Move Yoga ownership out of Kotlin

This is the highest-impact architectural shift.

Instead of:

- Kotlin owns Yoga nodes
- Kotlin mutates Yoga nodes per prop
- Kotlin runs layout and walks results

Move to:

- C++ owns Yoga nodes and dirty state
- C++ computes layout results and frame diffs
- Kotlin receives a compact mount/layout transaction

### Theme C: Shrink the JNI/Kotlin surface

The JNI surface should become coarse-grained:

- commit batch
- create/remove native platform view when needed
- apply mount/layout transaction
- dispatch events

It should stop being a high-frequency property interpreter.

### Theme D: Make atomic commits truly atomic

Atomic commit should mean:

- one logical UI transaction
- one layout calculation
- one platform apply pass
- one layout-event flush

Not:

- typed payload is atomic at entry
- but downstream work still fragments across queue drains and budget slices

### Theme E: Instrument the pipeline by phase

Before and during the refactor, Android needs stable numbers for:

- JS batch build time
- C++ decode time
- JNI transfer time
- prop normalization time
- Yoga calculate time
- mount/apply time
- layout event emission time
- total commit-to-present latency

Without this, future regressions will look mysterious again.

## Phased Plan

## Phase 0: Baseline the Real Cost Centers

Objective:
Turn the current Android pipeline into a measured pipeline.

Work:

- Add phase timing around:
  - typed batch decode
  - Kotlin op execution
  - Yoga calculate
  - frame apply
  - layout event dispatch
- Record per-frame:
  - op count
  - node count
  - changed-layout count
  - measure count
  - apply slices used
  - commit latency across frames
- Add comparable capture for iOS using the same benchmark scenarios.

Deliverables:

- Repeatable benchmark profiles for VirtualList and BottomTabs scenarios
- A per-phase Android vs iOS comparison table
- A “top 3 dominant costs” summary based on data, not guesses

Exit criteria:

- We can explain where Android time is actually spent in each benchmark class.

## Phase 1: Introduce a Native Commit Data Model

Objective:
Stop treating Kotlin method calls as the primary commit representation.

Work:

- Define a native transaction structure in C++ for:
  - node mutations
  - prop updates
  - child insert/remove operations
  - surface switching
- Decode typed ops into this structure once.
- Normalize string/numeric/boolean props into compact enums or typed payload records.
- Keep the old Kotlin path available behind a runtime flag during bring-up.

Deliverables:

- Native commit model
- Feature flag for new commit preparation path
- Benchmark comparison between old decode/apply and new decode/record path

Exit criteria:

- Most batch interpretation is no longer happening in Kotlin.

## Phase 2: Move Yoga Ownership to Native

Objective:
Make Yoga a native layout engine on Android, not a Java-side commit center.

Work:

- Create native Yoga node ownership and lifecycle in `zynthkit.cpp` or adjacent C++ units.
- Mirror the required style surface with typed native setters.
- Move dirty propagation and layout calculation to native.
- Keep Kotlin responsible only for platform view creation and final frame application.
- Provide a safe fallback path while parity is being validated.

Deliverables:

- Native Yoga tree manager
- Native layout calculation path
- Kotlin integration that consumes final layout results instead of driving Yoga directly

Risks:

- Text measurement and intrinsic sizing will still require careful platform hooks.
- Surface migration and subtree moves must stay correct.
- A half-migrated tree can easily regress performance if ownership boundaries are unclear.

Exit criteria:

- Java Yoga is no longer the default hotpath for Android layout.

## Phase 3: Build a Real Mount/Layout Transaction

Objective:
Replace per-node immediate application with a compact apply transaction.

Work:

- Produce a final transaction containing:
  - creates
  - deletes
  - reparent operations
  - final layout frames
  - non-layout view property mutations that must reach Android views
- Batch-apply this transaction on the main thread.
- Keep layout event emission tied to the same commit boundary.
- Remove normal-case multi-slice apply behavior for commits that fit within the target budget.

Deliverables:

- Coarse-grained apply API between native and Kotlin
- Reduced main-thread branching
- Atomic frame commit path for normal workloads

Exit criteria:

- A single logical commit usually maps to a single platform apply pass.

## Phase 4: Solve Text and Intrinsic Measurement Correctly

Objective:
Handle the hardest remaining source of layout churn without reintroducing Java-side bottlenecks.

Work:

- Define a stable measurement callback path for text and intrinsic views.
- Cache measurement inputs and outputs aggressively.
- Track why nodes become dirty:
  - text content
  - width constraint change
  - font/style change
  - subtree structural change
- Add measurement invalidation metrics.

Deliverables:

- Text measurement contract
- Dirty-reason tracking
- Measurement cache hit-rate reporting

Exit criteria:

- Variable-height VirtualList items do not regress due to text measurement ownership changes.

## Phase 5: Remove Legacy Fallbacks and Tune for Steady State

Objective:
Clean up transitional code and optimize the final architecture.

Work:

- Remove old Java Yoga hotpath code once parity is proven.
- Collapse duplicate style parsing logic.
- Remove temporary dual-write or verification paths.
- Tune transaction memory layout and pooling.
- Tune event emission and frame diff thresholds.

Deliverables:

- Default-native Android hotpath
- Reduced code duplication
- Stable benchmark wins in development and release builds

Exit criteria:

- Android no longer depends on the legacy Java Yoga path for target scenarios.

## Prioritization

### Must do

- Phase-level instrumentation
- Native commit data model
- Native Yoga ownership
- Coarse-grained mount/layout transaction

### Should do

- Dirty-reason tracking
- Measurement cache observability
- Runtime flags for staged rollout

### Nice to have

- Additional transaction pooling
- Specialized fast paths for VirtualList-heavy surfaces

These should come after the architectural moves, not before them.

## Acceptance Metrics

The refactor should not be declared successful because it “looks cleaner.” It should meet measurable targets.

### Functional targets

- No layout correctness regressions across existing renderer demos
- No broken surface moves, text measurement, or layout events
- No regression in SolidJS fine-grained update semantics

### Performance targets

- Development-mode Android should materially improve without requiring release APK + HBC just to look acceptable.
- VirtualList variable-height workloads should move substantially closer to iOS behavior.
- BottomTabs screen transitions should no longer spend most of their time in renderer commit/layout.
- One logical commit should usually complete in one frame on normal workloads.

### Telemetry targets

- Every benchmark run should expose per-phase cost
- Regressions should be attributable to a specific stage

## Risks and Mitigations

### Risk: lightweight refactor repeats the previous failure

Mitigation:

- Do not keep Java Yoga ownership and merely reshuffle calls around it.
- Treat native Yoga ownership as the pivotal change, not an optional extra.

### Risk: partial migration becomes slower than current code

Mitigation:

- Keep old and new paths behind a runtime flag during bring-up.
- Require benchmark checkpoints at the end of each phase.

### Risk: text measurement becomes the new bottleneck

Mitigation:

- Treat text measurement as its own phase, not an afterthought.
- Add dirty-reason metrics before deep optimization.

### Risk: apply transaction becomes too complex to debug

Mitigation:

- Add transaction tracing in debug builds.
- Keep commit artifacts inspectable and surface-scoped.

## Immediate Next Steps

1. Add phase timing and commit-latency telemetry to the current Android pipeline.
2. Write a technical design doc for the native commit data model and Android native Yoga ownership.
3. Implement the new path behind a feature flag.
4. Validate only two benchmark families first:
   - VirtualList with variable-height rows
   - BottomTabs screen load / navigation commits
5. Do not expand scope until those benchmarks show clear wins.

## Related Files

- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/runtime/JSBridge.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/layout/ZynthYogaLayout.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/layout/LayoutEngine.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManager.kt`
- `packages/zynth-core/android/ZynthKit/src/main/cpp/zynthkit.cpp`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthYogaLayout.m`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager+Scheduler.m`
