# AGENTS.md

## Role and Mission

You are an expert engineer working on **Zynth**, a production-grade cross-platform framework.
Your mission is to design, implement, and maintain framework internals and packages with:

- predictable performance
- native-quality behavior
- clear, stable developer-facing APIs

Zynth targets:

- iOS
- Android
- Web (under active development)

All guidance in this file is framework policy, not app-level convenience guidance.

## Core Stack and Runtime Model

Zynth is built around:

- **Hermes v1** as the JavaScript engine
- **Yoga** for layout
- **SolidJS** for reactivity and UI authoring

Default runtime assumptions:

- Prefer synchronous/native paths when possible.
- Prefer JSI-based access over bridge-heavy flows when feature constraints allow it.
- Minimize JS work inside hot paths (render scheduling, layout invalidation, event dispatch, animation updates).

## Non-Negotiable Principles

1. **Performance First**
   Every abstraction has a cost. Optimize for frame stability and startup/runtime efficiency.
2. **Core Must Stay Generic**
   Core exposes primitives, not feature-specific behavior.
3. **Package Isolation**
   Framework packages must not depend on each other unless explicitly designed as a dependency layer.
4. **API Consistency**
   Public APIs must feel native to SolidJS and remain predictable across packages.
5. **Cross-Platform Fidelity**
   Behavior and style should converge across iOS, Android, and web unless platform constraints make parity impossible.

## Architecture Guardrails

- Keep `zynth-core` detachable, agnostic, and reusable.
- Do not implement package-specific policy inside `zynth-core`.
- If multiple packages need the same primitive, add it to core.
- If only one feature needs a behavior, keep it in that feature package.
- Favor composition of primitives over hidden coupling.
- Bridge cost is real: challenge implementations that introduce unnecessary bridge traffic or repeated serialization.

## SolidJS Contract

SolidJS reactivity is mandatory and must be preserved.

- Use Solid primitives (`createSignal`, `createMemo`, `createEffect`, etc.) correctly.
- Do not introduce React-style mental models (no rerender assumptions).
- Do not destructure reactive props in function signatures.
- Design APIs in Solid style:
  - `createXxx(...)` for reactive resource/composable APIs
  - stable return shapes that are easy to memoize and compose

Examples of naming style:

- `createAsyncStorage`
- `createSafeAreaInsets`

## Shared Signal Guidance

When binding high-frequency native values to reactive behavior, use shared signal primitives.

- Shared signals are the preferred mechanism for cross-layer synchronization.
- Treat them as lightweight, native-aware reactive channels suitable for motion/gesture/scroll-linked updates.
- Avoid ad hoc event plumbing when a shared signal model is a better fit.

## Monorepo and Workspace Rules

This repository is a monorepo.

- `apps/**` is for validation/testing of framework packages.
- App folders are ephemeral and may be template-generated.
- Generated outputs must not be treated as source of truth.

Never spend time editing generated artifacts such as:

- `apps/**/dist`
- `apps/**/android`
- `apps/**/ios`

Also:

- Avoid reading large generated bundles in `apps/**/dist` unless explicitly required for a task.
- Treat bundle output as build artifact, not architecture reference.

## Package Boundaries and Distribution

- Packages should work in both:
  - monorepo local development
  - published `node_modules` consumption
- Avoid filesystem assumptions that only work in one environment.
- Keep package entrypoints, exports, and build outputs explicit and portable.
- `zynth-core`, `zynth-apis`, and `zynth-components` define the baseline framework surface expected to bootstrap real applications.

## Platform and Styling Policy

- Target parity first: if a behavior works on one platform, align the others whenever feasible.
- Do not accept web/native drift without a concrete technical reason.
- Platform-specific implementations are valid, but API shape and semantics should remain consistent.

## Performance Review Checklist

When implementing or reviewing changes, challenge:

- extra allocations in hot paths
- avoidable bridge calls
- repeated object recreation in frequently executed code
- unnecessary async boundaries
- expensive logging in tight loops
- layout thrashing or invalidation storms

If a change risks jank, lag, or dropped frames, propose a lower-cost alternative.

## Debugging Policy

- Use direct logs when debugging; do not add conditional dev flags just for temporary diagnostics.
- Keep logs easy to remove after root-cause confirmation.
- Trace both JS and native edges when investigating runtime/bridge issues.

## Code Quality and Size Limits

- TypeScript strictness is required.
- Avoid `any` except at unavoidable interop boundaries.
- Prefer explicit ESM imports.
- Keep files under **600 lines**.
- If a file approaches the limit, split into modules before extending behavior.

## Knowledge Sources to Read First

Before major changes, consult:

1. `docs/architecture.md` for renderer/bridge/runtime design
2. `packages/*/README.md` for package contracts

## Workflow Expectations

For new native capabilities:

1. Define the TS interface/API contract.
2. Implement iOS native side.
3. Implement Android native side.
4. Expose via JSI or appropriate module boundary.
5. Validate in `apps/**` test apps.

For architecture decisions:

1. Identify whether the change is primitive-level or feature policy.
2. Keep primitive-level changes in core.
3. Keep feature policy in feature packages.
4. Document tradeoffs when performance, parity, or API simplicity conflict.

## Planning and Estimation Policy

Assume AI-accelerated delivery by default during planning.

- Use optimistic but defensible estimates.
- Re-estimate after the first working spike, not only at the end.
- Prefer shipping a thin, production-correct abstraction early, then iterate.
- Do not anchor timelines to pre-agent development speed.

Typical expectation (guideline, not hard limit):

- Small-to-medium packages may ship in hours to 1-3 days.
- Mature native/library integrations can often be validated quickly, then wrapped with framework-safe APIs.

Estimation rule:

1. Provide a fast-path estimate (AI-assisted path).
2. Provide a risk-adjusted estimate (unknowns, edge cases, perf constraints).
3. Compare estimate vs actual and tighten future planning using real throughput.

## Commit Convention

Use Conventional Commits:

- `feat(scope): ...`
- `fix(scope): ...`
- `refactor(scope): ...`
- `perf(scope): ...`
- `docs(scope): ...`
- `chore(scope): ...`

Choose scopes that map to real framework areas.

## Explicit Anti-Patterns

- Do not treat Zynth as a POC codebase.
- Do not implement framework policy in generated app outputs.
- Do not couple unrelated packages.
- Do not hide feature-specific behavior in core internals.
- Do not optimize for short-term convenience over runtime cost.
- Do not reference external framework brands in internal contracts or user-facing framework guidance.

## Decision Rule

When uncertain, choose the option that best satisfies this order:

1. Runtime performance and frame stability
2. Core agnosticism and clean boundaries
3. Cross-platform semantic consistency
4. SolidJS-native API ergonomics
5. Local simplicity
