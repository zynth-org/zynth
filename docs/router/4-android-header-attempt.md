## Android AppBar Attempt – Lessons Learned

### Summary

Over the last iteration we tried to give the Android stack a native Toolbar/AppBar that matched the iOS header API (`headerTintColor`, `headerBackgroundColor`, etc). The goal was to let Kotlin fragments own both the surface and the header so every screen (including the initial Home route) could pick up the same declarative options Solid apps already use on iOS.

### What We Changed

1. **JS Router plumbing**
   - Added `header` options to the Android router’s type system, including `navigation.setOptions`.
   - Normalized the options and pushed them through a new `setHeaderOptions(surfaceId, json)` bridge call for every surface.
2. **Kotlin runtime**
   - Wrapped each `RuneRootView` inside a `Toolbar + content` container and applied the JSON config (title, tint, background, visibility).
   - Introduced a `resetStack` method so the native FragmentManager could own the initial Home fragment, not just pushed screens.
   - Stopped animating enter transitions for root fragments and skipped the back button when the fragment was the first route.
3. **JS rendering changes**
   - NavigationContainer delegated RESET/PUSH/POP to native so the fragment stack became the authority.
   - `StackRenderer` rendered a zero-sized placeholder whenever native controlled the UI, preventing Solid from painting over the fragment.

### Where Things Broke

- **Blank Home screen** – Once JS stopped rendering the initial Home view (because native “owned” it), the root Solid tree stayed empty while the fragment still needed JS to build the component hierarchy. Result: the device showed the Toolbar but not the screen content.
- **Back-stack bookkeeping** – Marking the first fragment as “root” required custom arguments and special casing `addToBackStack`. A few times the activity still thought there was a back-stack entry, so the toolbar showed a back arrow on Home or the navigation icon tint never applied.
- **Layout instability** – Wrapping `RuneRootView` in new containers triggered `LayoutParams` casts (FrameLayout vs LinearLayout), causing crashes until we added an intermediate frame host.
- **Reset coupling** – Delegating RESET entirely to native meant Solid never touched the screen tree again; that broke HMR/dev overlays and made it hard to debug since the inspector only saw `RuneRedBoxView`.

### Takeaways / What We’d Do Differently

1. **Hybrid first, full native later** – Keep JS rendering the initial screen (so dev overlays stay alive) and mount the native toolbar *above* the existing root view. Once that works, we can explore fragment-only stacks.
2. **Explicit ownership flag** – Instead of toggling `nativeControlled` deep in NavigationContainer, expose a prop so apps opt-in to native headers, and keep returning to JS when native fragments fail.
3. **Metrics before merge** – Add automated checks/logs that prove a header config was applied and a fragment rendered content before disabling the JS fallback.
4. **Smaller steps** – Prototype header plumbing in a feature branch with a dedicated sample app; only when Home + Details + HOT reload work should it merge back to `main`.

### Next Steps

We’re reverting the AppBar experiment. Future work should reintroduce the header in incremental stages:

1. Render a JS toolbar component that uses the same option names ( parity now, zero native risk ).
2. Once stable, swap the JS toolbar for a native `Toolbar` but keep JS in charge of rendering the screen content.
3. If we still want fragments to own the whole screen, add an opt-in navigation mode (e.g., `<NavigationContainer nativeFragments>`), so existing apps aren’t disrupted while we iterate.

This attempt showed the right API surface, logging, and header config flow, but coupling it to a full fragment-driven renderer was too disruptive for the current stack. The next iteration should decouple those pieces so feature work (headers) can land without taking down the basic render loop.
