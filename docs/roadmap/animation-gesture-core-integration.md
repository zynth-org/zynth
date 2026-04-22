# Animation and Gesture Core Integration Roadmap

Date: 2026-04-21
Status: Draft for alpha-era framework consolidation
Scope: `packages/zynth-core`, `packages/zynth-components`, `packages/zynth-animate`, `packages/zynth-gesture-handler`

## Purpose

This document captures a practical roadmap for making animation and gesture handling first-class framework capabilities in Zynth instead of long-term add-on packages.

The core thesis is simple:

- Shared signals, worklets, and UI-thread execution already belong to `@zynth/core`
- Motion and gesture ergonomics should feel native to `@zynth/components`
- Public runtime APIs should stay isolated through `@zynth/core/motion` and `@zynth/core/gesture`
- Alpha is the right time to remove redundant package boundaries before ecosystem expectations harden

This roadmap is also explicitly shaped to avoid the common pain points seen in other frameworks-style animation systems:

- wrapper component proliferation such as `Animated.View`
- split mental models between base views and animated views
- JS-thread dependency for steady-state motion
- manual userland wiring between gesture streams and animated state

## Executive Summary

Zynth already has most of the low-level substrate needed for this direction.

Today:

- `@zynth/core` already owns shared signals, worklets, UI scheduling, and native input-handler plumbing
- `@zynth/animate` adds public animation APIs plus native style-mapper ownership and transition helpers
- `@zynth/gesture-handler` adds gesture definitions and a detector attachment layer

That means the intended future architecture is not a speculative rewrite. It is mostly a consolidation and ownership correction.

Recommended end state:

- `@zynth/core` owns the motion runtime
- `@zynth/core/motion` is the public motion entry point
- `@zynth/core/gesture` is the public gesture entry point
- `@zynth/components` owns motion-capable primitives and gesture attachment ergonomics
- `@zynth/animate` is removed
- `@zynth/gesture-handler` is removed
- Plain primitives such as `<View>` and `<Text>` can accept animated styles directly when motion metadata is present
- Wrapper components such as `Animated.View` are not required for routine style animation

## Goals

### Primary goals

- Make animations and gestures first-class framework features.
- Keep per-frame animation work on the UI/native path.
- Allow base primitives to consume animated styles directly.
- Keep the public API modular through core subpath exports instead of separate runtime packages.
- Remove separate animation and gesture packages after integration.
- Keep the runtime model JSI-first and worklet-first.

### Secondary goals

- Improve authoring DX for component-library motion such as button press scale, shared transitions, and gesture-driven transforms.
- Reduce install/setup complexity for framework users.
- Keep the web target functional with explicit fallbacks where native drivers do not exist.

### Non-goals

- Do not add always-on per-node animation overhead to every render path.
- Do not make `@zynth/components` depend on JS-thread frame loops for native animation.
- Do not preserve `Animated.View` as a required long-term abstraction.
- Do not keep redundant runtime ownership split across multiple packages once consolidation is complete.
- Do not introduce external dependencies for animation or gesture architecture.

## Current State

## What already lives in core

These files show that the foundation is already in `@zynth/core`:

- `packages/zynth-core/src/sharedSignal.ts`
- `packages/zynth-core/src/worklet.ts`
- `packages/zynth-core/src/nativeRuntime.ts`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthWorklets.mm`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIBindings.mm`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManager.kt`

Capabilities already present there:

- native-backed shared signals
- worklet registration and scheduling
- UI-runtime execution
- sync access to shared values through JSI
- input-handler worklet attachment

## What `@zynth/animate` currently adds

Key files:

- `packages/zynth-animate/src/sharedValue.ts`
- `packages/zynth-animate/src/AnimatedView.tsx`
- `packages/zynth-animate/src/native.ts`
- `packages/zynth-animate/src/styleAnimations.ts`
- `packages/zynth-animate/src/layoutTransitions.ts`
- `packages/zynth-animate/ios/ZynthAnimateJSI.mm`
- `packages/zynth-animate/android/ZynthAnimate/src/main/cpp/ZynthAnimateJSI.cpp`

Current responsibilities:

- `createSharedValue`, `withTiming`, `withSpring`, `createAnimatedStyle`
- animated style metadata generation
- native style mapper lifecycle
- entry/exit animation helpers
- layout transition helpers
- `AnimatedView` wrapper that attaches animated style mapping to a host node

## What `@zynth/gesture-handler` currently adds

Key files:

- `packages/zynth-gesture-handler/src/GestureDetector.tsx`
- `packages/zynth-gesture-handler/src/gestures.ts`
- `packages/zynth-gesture-handler/src/types.ts`
- `packages/zynth-gesture-handler/android/ZynthGestureHandler/src/main/java/com/zynth/gesturehandler/ZynthGestureDetectorView.kt`

Current responsibilities:

- gesture definition builders
- gesture event normalization
- gesture detector wrapper component
- optional direct pan writes into shared signals

## Important architectural finding

Zynth is already partially prepared for direct animated styles on base components.

Relevant files:

- `packages/zynth-animate/src/sharedValue.ts`
- `packages/zynth-components/src/hooks/createStyle.ts`
- `packages/zynth-components/src/primitives/View.tsx`
- `packages/zynth-components/src/primitives/Text.tsx`

What this means:

- `createAnimatedStyle(...)` already produces metadata describing native style mappings
- `mergeStyles(...)` already preserves animated-style metadata
- `AnimatedView` is currently needed mainly because it owns native mapper attach/detach behavior

This is a strong sign that `Animated.View` is not structurally necessary. The missing piece is primitive-level mapper ownership, not a fundamental limitation in JSX or Solid reactivity.

## Target Architecture

The target architecture should be based on three rules:

1. Runtime ownership belongs in `@zynth/core`.
2. Primitive integration belongs in `@zynth/components`.
3. Public runtime domains should be exposed through focused subpath exports.
4. Optional motion behavior must be activated lazily only when motion metadata or gesture attachments exist.

## Runtime model

`@zynth/core` should own:

- shared value creation and storage
- animation clocks and native drivers
- native style mapper registration
- gesture signal attachment primitives
- UI runtime commands used by worklets

Public runtime access should be exposed through focused subpaths:

- `@zynth/core/motion`
- `@zynth/core/gesture`

`@zynth/components` should own:

- direct animated-style support in primitives
- gesture attachment APIs on host-backed primitives
- ergonomic entry/exit/layout motion props where relevant

## Public API model

The public architecture should prefer subpath exports over a flat root export surface.

Recommended shape:

- `@zynth/core/motion` for motion and animation runtime APIs
- `@zynth/core/gesture` for gesture definitions, events, and attachment contracts
- `@zynth/components` for primitives that consume those capabilities

This keeps the framework modular without reintroducing separate runtime packages.

Desired authoring shape:

```tsx
import { createAnimatedStyle, createSharedValue } from "@zynth/core/motion";

const scale = createSharedValue(1);

const animatedStyle = createAnimatedStyle(() => ({
  transform: [{ scale: scale.value }],
}));

<View style={animatedStyle} />
```

This should work without `Animated.View`.

Gesture-driven motion should also become more direct:

```tsx
import { createTapGesture } from "@zynth/core/gesture";
import { createSharedValue } from "@zynth/core/motion";

const pressed = createSharedValue(0);

<Pressable
  gesture={createTapGesture({
    onStart: () => {
      "worklet";
      pressed.value = 1;
    },
    onEnd: () => {
      "worklet";
      pressed.value = 0;
    },
  })}
  style={animatedStyle}
/>
```

This exact API shape may evolve, but the important framework rule is:

- the base primitive remains the primitive
- motion is attached through metadata or explicit props
- per-frame updates do not flow through JS when a native path exists

## Why wrapper components should not be the default

Avoiding `Animated.View` is the right direction if implemented correctly.

Reasons:

- It reduces API duplication across all primitives.
- It avoids separate animated and non-animated component families.
- It makes component-library motion much easier to apply consistently.
- It better matches Solid-style composability because style accessors can carry metadata.

But there is one guardrail:

- base primitives must not pay steady-state cost when no animation metadata is present

That means the primitive path should:

- check for animated metadata only when style is accessor-based
- create native style mappers lazily
- remove native mappers on cleanup
- keep static style application unchanged for non-animated usage

## Directive Strategy

Directives are not the recommended primary answer for animated styles.

Reasons:

- Zynth can integrate animated-style detection directly into primitive style handling.
- Direct style support keeps the API smaller and more intuitive.
- Solid 2.0 migration context already suggests avoiding dependency on legacy `use:` directive semantics.

However, directive-like or ref-factory attachment APIs may still be useful for:

- advanced gesture wiring
- imperative motion behaviors
- low-level host-node plugins

So the recommendation is:

- animated styles: integrate directly into primitive style pipelines
- gestures and advanced host attachments: consider ref-factory style attachment APIs where useful

## Package Consolidation Strategy

The final state should remove both public packages:

- `@zynth/animate`
- `@zynth/gesture-handler`

Because Zynth is alpha, backward compatibility should not block this consolidation.

The goal is not to collapse everything into a monolithic `@zynth/core` root export.

The goal is:

- one runtime-owning package
- multiple clear public core domains through subpath exports
- no misleading impression that motion and gesture are optional ecosystem add-ons

Recommended package policy:

- move runtime code and native bindings into `@zynth/core`
- expose motion APIs from `@zynth/core/motion`
- expose gesture APIs from `@zynth/core/gesture`
- move primitive-facing APIs into `@zynth/components`
- migrate existing imports inside the monorepo
- delete package-level native registration for the old packages
- remove the packages from the release manifest once integration lands

If a short bridge period is desired during active branch development, temporary internal re-exports are acceptable, but they should not survive as the long-term public architecture.

## Phases

## Phase 1: Consolidate Runtime Ownership Into `@zynth/core`

Objective:
Move animation and gesture runtime ownership into `@zynth/core` so all UI-thread motion primitives are framework-native.

### Work

- Move or absorb the animation-native bridge surface from:
  - `packages/zynth-animate/src/native.ts`
  - `packages/zynth-animate/ios/ZynthAnimateJSI.mm`
  - `packages/zynth-animate/android/ZynthAnimate/src/main/cpp/ZynthAnimateJSI.cpp`
- Re-home shared value and animation driver APIs from:
  - `packages/zynth-animate/src/sharedValue.ts`
  - `packages/zynth-animate/src/runtime.ts`
  - `packages/zynth-animate/src/easing.ts`
  - `packages/zynth-animate/src/interpolation.ts`
- Re-home gesture runtime primitives and direct shared-signal integration from:
  - `packages/zynth-gesture-handler/src/gestures.ts`
  - `packages/zynth-gesture-handler/src/types.ts`
  - `packages/zynth-gesture-handler/android/ZynthGestureHandler/...`
- Define one runtime-owned API surface in `@zynth/core` for:
  - shared values
  - animated style mapping
  - gesture definitions
  - gesture attachment contracts
  - UI-thread callbacks/worklets
- Publish that runtime surface through:
  - `@zynth/core/motion`
  - `@zynth/core/gesture`
- Unify naming where needed so `createSharedSignal` and `createSharedValue` are clearly related and not conceptually duplicated without reason.

### Suggested file targets

- `packages/zynth-core/src/sharedSignal.ts`
- `packages/zynth-core/src/worklet.ts`
- `packages/zynth-core/src/nativeRuntime.ts`
- new `packages/zynth-core/src/animation/*`
- new `packages/zynth-core/src/gesture/*`
- new `packages/zynth-core/src/motion.ts`
- new `packages/zynth-core/src/gesture.ts`
- `packages/zynth-core/ios/ZynthKit/src/runtime/*`
- `packages/zynth-core/android/ZynthKit/src/main/cpp/*`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/*`

### Deliverables

- one runtime-owned animation surface in `@zynth/core`
- one runtime-owned gesture surface in `@zynth/core`
- one public motion subpath export
- one public gesture subpath export
- native registration moved out of the old packages
- docs updated to describe motion and gestures as core runtime features

### Acceptance criteria

- Shared values and worklets continue to run with the same or lower latency.
- Native style mapping works without `@zynth/animate` registration.
- Gesture events and direct pan shared-signal updates work without `@zynth/gesture-handler`.
- Web still has a defined fallback path.

### Risks

- API duplication may persist if `createSharedSignal` and `createSharedValue` are both kept without clarified intent.
- Native registration order may regress during the move if the old package bootstrap code is removed too early.

## Phase 2: Integrate Motion Into Base Primitives In `@zynth/components`

Objective:
Allow core primitives to consume animated styles and motion props directly, without wrapper components.

### Work

- Teach primitives to detect animated-style metadata and lazily attach native style mappers.
- Move host-node mapper lifecycle logic out of `AnimatedView` and into shared primitive utilities.
- Add a small shared helper for:
  - reading animated-style metadata
  - attaching mapper on mount
  - updating mapper when mapping identity changes
  - removing mapper on cleanup
- Integrate this helper into:
  - `packages/zynth-components/src/primitives/View.tsx`
  - `packages/zynth-components/src/primitives/Text.tsx`
  - `packages/zynth-components/src/primitives/Pressable.tsx`
  - any component-library primitives that own native host nodes directly
- Re-home entry/exit and layout transition support so it can be expressed as primitive props instead of wrapper-only behavior.

### Suggested file targets

- `packages/zynth-components/src/hooks/createStyle.ts`
- new `packages/zynth-components/src/hooks/useAnimatedStyleMapper.ts`
- `packages/zynth-components/src/primitives/View.tsx`
- `packages/zynth-components/src/primitives/Text.tsx`
- `packages/zynth-components/src/primitives/Pressable.tsx`
- `packages/zynth-components/src/primitives/Button.tsx`

### Deliverables

- `<View style={animatedStyle} />` support
- `<Text style={animatedStyle} />` support where style properties are valid
- motion-capable component primitives without `Animated.View`
- shared primitive utility for animated style attachment

### Acceptance criteria

- Non-animated primitives do not allocate native style mappers.
- Animated styles attach only when metadata exists.
- No extra wrapper component is required for routine transform, opacity, or size animations.
- Primitive style reactivity remains Solid-safe and does not rely on prop destructuring.

### Risks

- If primitive integration is done carelessly, static style updates and animated style ownership may fight over the same prop path.
- Entry/exit and layout motion may still need a thin higher-order abstraction for a subset of cases, especially when presence management is involved.

## Phase 3: Remove Legacy Package Boundaries And Standardize The New API

Objective:
Finish the consolidation, delete redundant packages, and lock the new framework-facing motion model.

### Work

- Migrate all monorepo imports away from:
  - `@zynth/animate`
  - `@zynth/gesture-handler`
- Standardize imports onto:
  - `@zynth/core/motion`
  - `@zynth/core/gesture`
- Remove native package registration metadata from:
  - `packages/zynth-animate/package.json`
  - `packages/zynth-gesture-handler/package.json`
- Delete or archive:
  - `packages/zynth-animate`
  - `packages/zynth-gesture-handler`
- Update docs, templates, examples, and package manifests.
- Add guidance for component authors on:
  - when to use animated styles
  - when to use gesture props or attachments
  - how to keep motion on the UI thread

### Suggested file targets

- `docs/package-release-manifest.json`
- framework docs and examples referencing animation or gesture setup
- package exports in `packages/zynth-core/src/index.ts`
- package subpath exports in `packages/zynth-core/package.json`
- `packages/zynth-core/src/motion.ts`
- `packages/zynth-core/src/gesture.ts`
- package exports in `packages/zynth-components/src/index.ts`

### Deliverables

- no separate animation package
- no separate gesture-handler package
- stable public subpath exports for motion and gesture
- one consolidated framework motion story
- one installation/setup story for users

### Acceptance criteria

- New apps do not install or import separate motion packages.
- New apps import runtime motion and gesture APIs from core subpaths.
- Existing monorepo examples compile against the new surfaces.
- The public docs describe motion as part of Zynth itself, not an ecosystem add-on.

### Risks

- If deletion happens before docs/examples are updated, the new model will feel incomplete even if the runtime is correct.

## Cross-Cutting Design Rules

These rules should stay true in every phase:

- UI-thread motion first. JS-thread fallback only when native execution is impossible.
- No permanent wrapper requirement for animated primitives.
- No always-on per-node motion tax.
- Keep SolidJS reactivity intact by operating on accessors and metadata, not destructured props.
- Avoid duplicate runtime concepts with different names unless the distinction is real and documented.
- Keep package boundaries aligned with ownership, not with historical implementation accidents.

## Validation Matrix

The implementation should be validated against these usage classes:

- transform and opacity animations on `View`
- animated text style updates on `Text`
- press-scale and press-opacity interactions on `Pressable` and `Button`
- pan-driven translation with direct shared-value updates
- gesture-to-worklet-to-style pipelines without JS-thread participation
- entry/exit animation behavior on mounted/unmounted component trees
- layout transitions where supported
- web fallback behavior when native drivers are unavailable

## Recommended First Milestone

The best first milestone is not deleting packages immediately.

The best first milestone is:

- move style mapper ownership and shared-value runtime ownership into core
- enable direct animated styles on `View` and `Text`
- validate button press-scale and pan-to-transform as proof cases

Once that lands, package deletion becomes much lower risk because the most important DX and architecture win will already be real.

## Definition of Done

This roadmap should be considered complete when:

- animation runtime ownership is in `@zynth/core`
- public runtime entry points exist at `@zynth/core/motion` and `@zynth/core/gesture`
- primitive motion integration is in `@zynth/components`
- direct animated styles on base primitives are supported
- gesture integration no longer depends on a separate public package
- `@zynth/animate` and `@zynth/gesture-handler` are removed
- the public framework story for motion is smaller, clearer, and faster than the split-package model
