# FlatList Performance Rules

This checklist captures the invariants that keep our Solid-based `FlatList` efficient and recyclable. Every new feature or refactor must respect these guardrails; breaking them reintroduces the memory leaks and bridge storms that forced us to rewrite the list in the first place.

## Structural Invariants

1. **Pool length never changes after mount.**
   - `bindings()` must remain the same array length.
   - No `setBindings([...bindings(), …])` or splice operations after initialisation.

2. **Slots keyed by position only.**
   - Keep using `<Index each={bindings()}>`.
   - Never swap to `<For>` or use data-derived keys for slots.

3. **One render root per slot.**
   - Each slot must create its `createRoot` only once and reuse it.
   - Do not re-run `props.renderItem` outside of the per-slot root.

4. **Proxy-backed item/index.**
   - Maintain the current `itemProxy` and `indexValue` indirection.
   - Avoid spreading `{ ...item }` or destructuring out of the proxy; that snapshots stale data and triggers re-renders.

5. **Fixed layout container.**
   - The absolute-positioned slot container (`position: "absolute"`, width/height from `itemSize`) must stay.
   - Do not wrap slots in additional layout nodes that Solid would reconcile.
   - Sanitize `contentContainerStyle` before applying it so user overrides can’t clobber required layout keys.

## Host Integration Rules

1. **Must enable host recycling.**
   - Keep the `enableRecycling` call tied to the native scroll ref.
   - Always clean up via `disableRecycling` in `onCleanup`.

2. **Do not bypass host batching.**
   - No direct mutation of native nodes outside host APIs.
   - Keep using `setProp`/`setText` via existing abstractions.

3. **Preserve descendant tagging.**
   - Any new native element inserted into slot content must inherit the recycling context (Android already propagates this—avoid patterns that detach children and reattach them elsewhere).

## Reactive Flow

1. **`dataIndex` drives updates—nothing else.**
   - Effects should derive from `binding().dataIndex`; do not watch the entire `bindings()` array.

2. **Signals over derived arrays.**
   - When adding computed values (e.g., sticky headers), store them in signals per slot, not in objects returned from `renderItem`.

3. **Avoid returning `null` from `renderItem` for visible slots.**
   - Empty slots should be handled by positioning at `-9999`, not by rendering `null`, to keep Solid from unmounting the root.

## Performance Tests / Telemetry

1. **Log guard:**
   - New code must not reintroduce `[Host/createNode] 🆕` logs during steady-state scrolling.
   - Add regression tests/log monitors if we automate the suite.

2. **Memory sanity checks:**
   - Profiling should stay within ~60 MB “Others” / ~30 MB “Native” after sweeping 1000 items in demo builds.

3. **Scroll smoothness:**
   - Maintain the current absence of gaps—Yoga should only reposition existing nodes.

## Anti-Patterns to Reject

- Using `<For>` or array maps inside slots.
- Rebinding the entire `bindings` signal instead of mutating entries.
- Calling `renderItem` outside the cached root (e.g., inside `createEffect`).
- Introducing synchronous loops that call `setCurrentItem` multiple times per frame.
- Dependence on data keys for slot identity.

## Change Review Checklist

Before merging any FlatList patch, verify:

- [ ] Pool length remains constant and `<Index>` is intact.
- [ ] Slot root creation is still single-use, proxy remains in place.
- [ ] Host recycling setup/teardown untouched.
- [ ] No new Solid constructs that trigger reconciliation (e.g., nested `<Show>` toggling entire slot).
- [ ] No new bridge logs or memory cliffs in manual test.

Keep this document current. If a feature requires relaxing an invariant, document the rationale here and add guards/tests to keep the recycler from regressing.***
