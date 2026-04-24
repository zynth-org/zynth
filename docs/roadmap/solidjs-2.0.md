# SolidJS 2.0 Roadmap

Date: 2026-04-19
Status: Draft for package-level migration tracking

## Purpose

This document captures the SolidJS 2.0 beta changes most relevant to Zynth so future package reviews can extend one shared roadmap instead of re-discovering the same migration context.

It is intentionally framework-focused:

- What changed in SolidJS 2.0 beta
- What is likely to affect Zynth packages
- What appears immediately relevant to `@zynthjs/core`
- What package owners should validate when they review their own package
- Where Solid 2.0 may create new opportunities for native-first Zynth APIs

## Source of Truth

Official SolidJS references used for this roadmap:

- [Solid 2.0 roadmap discussion](https://github.com/solidjs/solid/discussions/2425)
- [Solid 2.0 beta release](https://github.com/solidjs/solid/releases/tag/v2.0.0-beta.0)
- [Solid 2.0 migration guide](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/MIGRATION.md)
- [RFC: Reactivity, batching, and effects](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/01-reactivity-batching-effects.md)
- [RFC: Signals, derived primitives, ownership, and context](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/02-signals-derived-ownership.md)
- [RFC: Control flow](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/03-control-flow.md)
- [RFC: Stores](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/04-stores.md)
- [RFC: Async data](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/05-async-data.md)
- [RFC: Actions and optimistic updates](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/06-actions-optimistic.md)
- [RFC: DOM](https://raw.githubusercontent.com/solidjs/solid/next/documentation/solid-2.0/07-dom.md)

## Executive Summary

SolidJS 2.0 beta looks like a meaningful migration for the Zynth ecosystem, but not an automatic framework rewrite for `@zynthjs/core`.

Current assessment:

- `@zynthjs/core` likely needs a focused compatibility pass, not a major architectural rewrite.
- The highest-risk areas are renderer/runtime contracts, scheduler semantics, and import/export changes.
- The highest migration volume across the monorepo will likely be outside `zynth-core`, especially in packages that use `createEffect`, `createResource`, `splitProps`, stores, or web DOM helpers.
- Native iOS/Android packages may benefit from Solid 2.0's scheduler and derived primitive model once parity is established.

## SolidJS 2.0 Changes That Matter To Zynth

### 1. Microtask batching and explicit `flush()`

Solid 2.0 changes the scheduler so writes are batched by default and reads do not observe the new value until the batch flushes.

Implications for Zynth:

- Any code that assumes `setX(...); x()` immediately reflects the new value must be reviewed.
- Controlled input flows, imperative measurement, focus sequencing, and native host sync points need verification.
- Packages with their own flush or commit semantics should validate that they align with Solid's new scheduling model.

Why this matters for Zynth:

- `@zynthjs/core` already exposes `flush()` and native hosts already coordinate explicit UI flushes.
- This is promising for native runtimes, but it must be validated carefully because Zynth has host-level batching on top of Solid's batching.

### 2. Effects are split into compute and apply phases

Solid 2.0 changes `createEffect` from a single callback into a split model:

- compute phase: reactive reads
- apply phase: side effects and cleanup

Implications for Zynth:

- Packages using `createEffect` will need migration work.
- Side effects performed during tracking need to move into the effect/apply side.
- Cleanup patterns may need to move from `onCleanup` inside effect bodies into returned cleanup functions.

Why this matters for Zynth:

- This is not a large direct risk for `@zynthjs/core` today.
- It is likely a major review topic for UI, API, and helper packages.

### 3. `onMount` is replaced by `onSettled`

Solid 2.0 replaces `onMount` with `onSettled`.

Implications for Zynth:

- Packages relying on mount-time setup, subscriptions, measurement, or listener wiring need review.
- Any mount logic that assumed synchronous readiness should be re-validated.

### 4. Stricter reactivity guardrails

Solid 2.0 adds dev-time warnings or errors for:

- top-level reactive reads in component bodies
- destructuring reactive props at the top level
- writes inside reactive scopes or owned scopes

Implications for Zynth:

- Packages that destructure props in components are especially exposed.
- Library code that performs signal/store writes inside effects or memo-like logic needs migration.
- Package authors need to re-check custom control-flow callbacks and helper abstractions.

Why this matters for Zynth:

- This lines up with Zynth's existing SolidJS guidance to avoid destructuring props.
- It should help catch bugs earlier, but will likely produce new warnings across component packages.

### 5. Ownership rules become stricter

Solid 2.0 makes owned lifetimes more explicit and changes default assumptions around roots and detached reactive graphs.

Implications for Zynth:

- Packages that create nested roots, long-lived singleton reactive state, or external integrations need review.
- If a package relied on effectively detached roots, it may need explicit detachment.

Why this matters for Zynth:

- This is mainly a review item for libraries with advanced reactive lifetimes.
- It could improve cleanup correctness and reduce leaks in long-running native runtimes.

### 6. Stores change significantly

Solid 2.0 changes store ergonomics:

- `createStore` moves into `solid-js`
- setters are draft-first by default
- `produce` becomes unnecessary in common cases
- `splitProps` is replaced by `omit`
- `mergeProps` is replaced by `merge`
- `unwrap` is replaced by `snapshot`
- path-style store updates become optional compatibility via `storePath(...)`

Implications for Zynth:

- Any package using `solid-js/store` imports needs migration.
- Any package using path-style store setters needs review.
- Any package using `splitProps`, `mergeProps`, `unwrap`, or `produce` needs migration.

Why this matters for Zynth:

- This will almost certainly affect multiple packages outside `zynth-core`.
- It is one of the biggest ecosystem-wide migration categories.

### 7. Async model changes substantially

Solid 2.0 removes `createResource` in favor of async computations plus `Loading`, `isPending`, `refresh`, and optimistic/action primitives.

Implications for Zynth:

- Packages using `createResource` need migration planning.
- Existing loading/error patterns may need restructuring.
- Async APIs in routing, data, asset loading, or fonts should be reviewed.

Why this matters for Zynth:

- This is not currently a major `zynth-core` issue.
- It is likely relevant to higher-level packages and app-facing APIs.

### 8. Control-flow and async boundary changes

Solid 2.0 changes several control-flow primitives:

- `Index` is replaced by `<For keyed={false}>`
- `For` child arguments become accessors
- `Suspense` becomes `Loading`
- `ErrorBoundary` becomes `Errored`
- `SuspenseList` becomes `Reveal`

Implications for Zynth:

- Component packages using control-flow helpers need migration review.
- Callback bodies that assume direct values instead of accessors need updates.

### 9. DOM and directive changes

Solid 2.0 changes web-facing DOM behavior:

- `solid-js/web` moves to `@solidjs/web`
- `solid-js/universal` moves to `@solidjs/universal`
- `use:` directives are removed in favor of `ref` directive factories
- `classList` is folded into `class`
- attribute handling becomes more HTML-aligned

Implications for Zynth:

- Web adapters and custom renderer integrations need validation.
- Packages with DOM-only helpers or custom directives need migration.

Why this matters for Zynth:

- This is especially relevant to `@zynthjs/core` web support and any package with web-only compatibility layers.

## Current `@zynthjs/core` Assessment

## Summary

`@zynthjs/core` appears less exposed than many userland packages because it currently does not rely heavily on the highest-churn 2.0 APIs such as:

- `createEffect`
- `onMount`
- `createResource`
- `Suspense`
- `Index`

However, it is still highly sensitive because it owns:

- the Solid-facing renderer contract
- native host batching and flush behavior
- Solid helper re-exports
- the web host fallback layer

## Areas likely requiring changes

### Import and package boundary changes

`@zynthjs/core` currently exposes or imports Solid APIs using 1.x paths and names.

Examples to revisit:

- `solid-js/store`
- `solid-js/web`
- `mergeProps`
- universal runtime compatibility exports

Expected work:

- add a compatibility layer or migrate imports directly
- keep Zynth's public runtime surface stable where practical
- avoid leaking beta-specific import churn into every downstream package

### Renderer contract validation

The custom renderer in [packages/zynth-core/src/renderer.ts](/Users/zsaboi/code/zynth/framework/packages/zynth-core/src/renderer.ts:1) is the most sensitive area.

Expected work:

- validate assumptions around `createRenderEffect`
- confirm insert/spread/ref behavior against Solid 2.0 runtime expectations
- confirm marker, array reconciliation, and cleanup behavior under the new scheduler
- verify that host-level batching composes correctly with Solid's microtask batching

### Scheduler and flush semantics

`@zynthjs/core` already exposes a host flush path.

Expected work:

- verify immediate-read expectations after setters
- test controlled inputs and imperative measurement paths
- confirm behavior during mount, rerender, HMR, and event-driven updates

### Web host migration

The web adapter in [packages/zynth-core/src/host/web.ts](/Users/zsaboi/code/zynth/framework/packages/zynth-core/src/host/web.ts:152) is a direct migration target.

Expected work:

- migrate import paths
- validate `createStore` usage against draft-first semantics
- validate component registration helpers against DOM model changes

## Areas likely requiring validation more than redesign

### Shared/native-backed signal wrappers

The shared signal and sync signal wrappers maintain native-backed cached values alongside Solid signals.

This may actually help under Solid 2.0 because:

- Solid reads no longer reflect writes immediately until flush
- Zynth already keeps explicit cached/native state for some synchronous native interactions

Expected work:

- verify timing assumptions
- verify no hidden immediate-read dependency on 1.x behavior
- verify no new owned-scope write warnings appear in edge cases

### Start/runtime bootstrap

Boot and rerender flows in `@zynthjs/core` should be reviewed under the new scheduler, but no immediate architectural rewrite is indicated.

## Migration Risk By Package Type

### High risk

- Packages that use `createEffect`
- Packages that use `onMount`
- Packages that use `createResource`
- Packages that use `splitProps`, `mergeProps`, `unwrap`, or `produce`
- Packages that rely on `solid-js/store`, `solid-js/web`, or `solid-js/universal`
- Packages with custom directives or DOM-specific behavior

### Medium risk

- Packages with store-heavy APIs
- Packages with context/provider abstractions
- Packages with custom control-flow patterns
- Packages that create internal roots or long-lived reactive graphs
- Packages that coordinate imperative DOM/native timing after state writes

### Lower risk

- Packages that mainly use `createSignal`, `createMemo`, and plain JSX
- Packages that already follow non-destructuring prop patterns
- Packages with limited or no async/resource abstractions

## Suggested Package Review Template

Each package review should answer the following:

### API usage inventory

- Does the package import from `solid-js/store`, `solid-js/web`, or `solid-js/universal`?
- Does it use `createEffect`, `onMount`, `createResource`, `Suspense`, `ErrorBoundary`, `Index`, `splitProps`, `mergeProps`, `unwrap`, `produce`, `batch`, or `createComputed`?
- Does it use `use:` directives, `classList`, or custom DOM-only helpers?

### Reactivity integrity

- Does it destructure props in components?
- Does it perform top-level reactive reads in component bodies?
- Does it write to signals or stores inside reactive scopes?
- Does it rely on direct values in `For` or other function-child control-flow callbacks?

### Scheduler assumptions

- Does it assume setter writes are visible immediately?
- Does it read DOM/native layout immediately after state writes?
- Does it need an explicit `flush()` or equivalent host commit point?

### Ownership and lifecycle

- Does it create nested roots?
- Does it rely on detached or singleton reactive graphs?
- Does it use mount-time setup that should move to `onSettled`?

### Store migration

- Can path-style updates become draft-first updates?
- Does it need `storePath(...)` temporarily for compatibility?
- Should `splitProps` become `omit`?
- Should `mergeProps` become `merge`?
- Should `unwrap` become `snapshot`?

### Async migration

- Does `createResource` need replacement with async computations?
- Should loading UX migrate to `Loading` and `isPending`?
- Are there opportunities to replace ad hoc mutation flags with `action()` and optimistic primitives?

### Opportunity scan

- Can derived writable primitives simplify the package?
- Can lazy memos reduce startup or branch-only work?
- Can built-in transitions or async computations improve UX or simplify APIs?

## Native-Specific Opportunities For Zynth

### Opportunity 1: Better alignment between host flushes and Solid scheduling

Zynth already has explicit native flush behavior. Solid 2.0's clearer scheduler could make host commit boundaries easier to reason about for:

- controlled inputs
- focus management
- measurement
- staged native updates

### Opportunity 2: Derived primitives for native-backed state

Function-form `createSignal` and `createStore` may be useful for:

- state mirrored between JS and native host objects
- writable derived state around JSI-backed values
- reducing custom write-back plumbing in some helpers

### Opportunity 3: Cleaner async screen/data APIs above core

While not a `zynth-core` migration driver, the 2.0 async model may simplify higher-level native app APIs by replacing:

- resource-specific loading state
- manual transition wrappers
- ad hoc optimistic mutation flows

### Opportunity 4: Better diagnostics from stricter reactivity rules

The new warnings around top-level reads and writes in reactive scopes may help package owners catch mistakes that are already problematic in native runtimes but currently harder to detect early.

## Proposed Migration Plan

### Phase 1: Framework compatibility spike

Goal:
Establish the exact Solid 2.0 beta breakage surface for `@zynthjs/core`.

Tasks:

- audit current Solid imports and helper re-exports
- validate renderer contract assumptions
- validate flush and scheduling behavior on native and web hosts
- document any Solid 2.0 beta behavior gaps that require framework shims

### Phase 2: Core compatibility layer

Goal:
Reduce churn for downstream packages by centralizing unstable migration points.

Tasks:

- isolate renamed helper APIs where practical
- normalize import path transitions
- keep `@zynthjs/core` public integration points stable if possible
- add migration notes for downstream package authors

### Phase 3: Package-by-package reviews

Goal:
Assess every Zynth package using one shared migration rubric.

Tasks:

- classify each package as high, medium, or low migration risk
- record required changes and optional opportunities
- link package-specific notes back to this roadmap

### Phase 4: Opportunity pass

Goal:
After compatibility is achieved, evaluate Solid 2.0 features that can improve Zynth design.

Tasks:

- review derived primitives for native-backed abstractions
- review async primitives for higher-level package APIs
- review lazy memo and scheduling opportunities in hot paths

## Initial Conclusions

- SolidJS 2.0 beta is important enough that Zynth should track it centrally now.
- `@zynthjs/core` does not currently look like a rewrite candidate, but it is a high-sensitivity compatibility package.
- The largest total migration surface is likely outside `zynth-core`, especially in package-level Solid APIs and stores.
- Zynth's existing native/runtime architecture still fits Solid 2.0 well.
- The best strategy is to stabilize `@zynthjs/core` first, then fan out package reviews with this document as the shared baseline.

## Follow-up

Future package-specific migration notes should:

- link back to this document
- list exact Solid APIs used by the package
- record required code changes
- record validation tasks
- record any Solid 2.0 opportunities discovered during review
