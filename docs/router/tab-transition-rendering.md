---
title: Tab transition rendering hold
---

## Problem

Users reported a white flash during tab switches: the previous fragment was hidden before the next SolidJS surface produced any native frames, so the fragment container briefly became empty while we waited for rendering to complete.

## Solution

1. `RouterScreenFragment` now tracks both the JavaScript render (`markContentRendered`) and the native layout measurement (`viewMeasured`). When both are satisfied it notifies `RuneNavigationContainer` through `onFragmentContentReady`. Each fragment resets these flags on teardown.
2. `notifyScreenRendered` still waits for `addSurfaceFirstFrameListener` when possible, but it now only marks the fragment as rendered; the tab controller decides when it is safe to hide the old fragment.
3. The tab controller maintains `fragmentAwaitingHide` plus a bitmap snapshot from `RuneNavigationHostLayout`. During a tab switch we keep the outgoing fragment (and its screenshot) visible until the incoming fragment reports readiness; only then do we hide the previous fragment and clear the snapshot.

## What to trust moving forward

- The listener is safe because we wrap it in `runCatching`, execute it on the UI thread, and double-check that the fragment is still registered before touching it.
- The layout measurement guard prevents us from clearing the snapshot until Android actually measured the view, so even if the listener fires early we still keep something on screen.
- The deferred hide logic keeps either the real fragment or the snapshot covering the container until the next ready signal arrives, eliminating the blank frame.

## Follow-up ideas

- If a tab ever fails to report readiness (e.g., due to an error), consider adding a short fallback timer that forces the snapshot to clear after a configurable delay, so the app doesn’t appear stuck forever.

## Programmatic tab navigation

- Calling `navigation.navigate("SomeTab")` now checks whether `SomeTab` is one of the registered tabs. If it is, we delegate to the tab controller and avoid pushing a new stack entry, so the bottom bar and AppBar stay consistent with a real tab switch.
- The native implementation ignores any params when the destination resolves to a tab, since the existing tabs are long-lived fragments that do not re-render with new params on every switch. You can still pass params when pushing a stack screen that happens to share the same name as a tab, but in that case you must ensure the tab is not registered.
