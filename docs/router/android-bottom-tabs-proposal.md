# Android Bottom Tabs – Native Proposal

This note outlines how we can extend the current fragment-based router to implement a Material bottom navigation bar without repeating the pitfalls we just solved for Stack. The goal is parity with iOS tabs, native visuals, and predictable surface management.

## Starting Point

We already have:

1. **`RuneNavigationContainer`** – Owns the activity, keeps the runtime root hidden, and hosts a `FragmentContainerView`. It registers screens, pushes `RouterScreenFragment`, and broadcasts stack events.
2. **`RouterScreenFragment`** – Creates a toolbar + `RuneRootView`, registers a dedicated surface, focuses it before JS render, and disposes it in the right order.
3. **JS plumbing** – `NavigationContainer` knows when native is active, `nativeRenderer.ts` renders into arbitrary surface IDs, and the bridge exposes `registerScreens`, `navigate`, `goBack`, `setOptions`.
4. **Diagnostics** – `RuneSurface` logs plus fragment logs make it obvious when nodes hit the wrong surface or layout fails.

These pieces are reusable if we treat tabs as a sibling navigator rather than a separate system.

## Proposed Architecture

### 1. Container Layout

- Keep `RuneNavigationContainer` as the host view. Add a bottom slot for `MaterialToolbar`’s sibling: use `com.google.android.material.bottomnavigation.BottomNavigationView` at the bottom with `layout_gravity=bottom`. Above it, a `FragmentContainerView` (or dedicated `FrameLayout`) hosts fragments.
- Size the fragment area to `MATCH_PARENT` height minus the navigation bar height. Similar to how we padded the AppBar, use window inset listeners to adjust for gesture nav and avoid manual padding hacks.

### 2. Fragment Strategy

Two viable patterns:

1. **Multiple retained fragments (classic tabs)**  
   - Pre-create a fragment per tab (each with its own `RouterScreenFragment` + surface).  
   - `RuneNavigationContainer` keeps them attached but shows/hides via `FragmentTransaction.attach/detach` or `setMaxLifecycle`.  
   - Pros: retains per-tab navigation stacks (stack-in-tab).  
   - Cons: more memory; need to throttle surface count.

2. **Single fragment with surface swapping (Lightweight)**  
   - Keep one `RouterScreenFragment`; change its `routeName` + params when a tab is selected, but keep a separate `RuneRootView` per tab and swap the focused surface.  
   - Pros: fewer fragments; better for simple “tab root only”.  
   - Cons: need explicit caching of surfaces.

Given we already rely on `RuneRootView` surfaces, option (1) is safer: each tab’s root stays alive, JS can keep routers (stack) inside tabs, and we reuse fragment lifecycles for focus/disposal.

### 3. JS API

- Mirror iOS: `<Tabs.Navigator>` with `<Tabs.Screen name="Home" component={Home} options={{ tabBarIcon, title, headerShown }}/>`.
- Reuse `registerScreens` payload but add `type: "tab"` or separate `registerTabs`.
- Introduce `setTabs`/`switchTab` methods in `RuneAndroidRouterBridge`.

### 4. Surface Management Lessons

| Lesson | Application to Tabs |
| --- | --- |
| Always call `setActiveSurface` before JS mutations. | When selecting a tab, focus that tab’s fragment surface before invoking JS render or before calling `setOptions`. |
| Dispose before unregister. | When removing a tab fragment (e.g., dev reload), run `__disposeRouterScreen` before `runtime.unregisterSurface`. |
| Unique node IDs per surface. | Already solved by bumping `nextId` in `registerSurfaceInternal`; tabs simply register additional surfaces. |
| Host layout should match container type. | Use `FrameLayout` + `BottomNavigationView` to avoid `LayoutParams` mismatches. Keep `RuneRootView` wrapped in `FrameLayout`. |
| Log everything. | Extend `RuneSurface` logging to include tab selection events (`selectTab`, `attachTabFragment`). |

### 5. Native Module Changes

- Extend `RuneAndroidRouterBridge` with methods: `registerTabs`, `switchTab`, `setTabOptions`.
- `RuneNavigationContainer` maintains a `tabs` map (tabId → fragment) and handles selection events from JS and from `BottomNavigationView`.
- Each tab fragment can reuse `RouterScreenFragment` or a lighter variant (`RouterTabFragment`) if we want to drop the toolbar per tab.

### 6. Avoiding Previous Pitfalls

1. **Layout Params crash** – Keep every `RuneRootView` inside a `FrameLayout` even in tab fragments. Use consistent container types across stack/tabs.
2. **Duplicate render authorities** – Tabs must stick to the same “native owns the screen” rule. When tabs are active, JS should not render content in root `0`.
3. **Measurement races** – Use the same inset listener to size the fragment area; no ad-hoc padding loops.
4. **Surface leakage on dev reload** – Hook into `navigationContainer.clear()` to dispose all tab fragments and unregister their surfaces.

## Implementation Steps

1. **Refactor host view** – Extract a `RuneNavigationHostLayout` that can host (toolbar | fragment | bottom nav). Stack currently only uses top + fragment; tabs will reuse the same host but enable bottom slot.
2. **Tab manager** – Add `RuneTabController` inside `RuneNavigationContainer` to:  
   - Track registered tabs  
   - Create fragments via `RouterScreenFragment.newInstance` per tab  
   - Respond to bottom navigation selection + JS `switchTab`.
3. **JS API** – Add `createTabNavigator` similar to Stack’s, hooking into existing registry + `registerScreensNative` payload.
4. **Options sync** – Extend `RouterScreenOptions` or add `TabOptions` (badge, icon). Reuse color parsing helpers.
5. **Diagnostics** – Add log lines (`RuneTabs`) when tabs register, surface IDs, and when we focus a tab.

## Open Questions

- Do we support per-tab stacks (i.e., each tab hosts its own stack) or only single-screen tabs initially? Reusing `RouterScreenFragment` suggests we can embed stack navigators within each tab (JS-driven) while the native router operates at a higher level.
- How to handle reselecting the active tab (scroll to top, pop-to-root)? Need events from `BottomNavigationView`.
- Should the bottom bar itself be customizable from JS (icons, labels, badges)? Likely a follow-up; initial MVP can hardcode label/icon arrays from options.

## Next Steps

1. Prototype `RuneNavigationHostLayout` that reserves top/bottom slots with inset handling.
2. Define `registerTabs` payload (name, icon, initialRoute, options).
3. Implement a minimal `RuneTabFragment` that reuses the surface registration + focus logic from `RouterScreenFragment`.
4. Add JS primitives (`createBottomTabs`, `Tab.Screen`) and native bridge methods.
5. Instrument selection/attach/detach with the same logging strategy.

By building tabs on top of the fragment + surface patterns we trust, we avoid reintroducing layout crashes, double renders, or surface leaks. Once the basic flow mirrors Stack’s stability, we can layer icon badges, animations, and advanced behaviors.
