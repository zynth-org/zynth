# Memory Router – Native Bottom Tabs Plan

## Why We’re Doing This

- We already have the memory router rendering stack transitions via native primitives (`rune-screen`, etc.) on iOS, which gives us real `UINavigationController` animations while keeping navigation state in JS.
- Bottom tabs should follow the same philosophy: JS own the routing logic, native renders the chrome. Using the system `UITabBar`/`UITabBarController` brings the “liquid glass” look, platform gestures, and accessibility for free.
- We need a clear plan so that the upcoming implementation mirrors what we did for stack screens without slipping back into native-owned routing.

## Current Building Blocks

| Area | Files / Notes |
| --- | --- |
| JS Stack Navigator | `packages/rune-memory-router/src/navigators/Stack.tsx` – builds `ScreenPrimitive`s, routes header options through `headerOptions` prop, listens for `onNativeBack`. |
| Screen primitives | `packages/rune-screens/src/Screen.tsx`, `ScreenContainer.tsx`, `types.ts`, `jsx.d.ts` – Solid components that map props to native host views. |
| iOS view layer | `packages/rune-screens/ios/src/RuneScreenView.swift`, `RuneScreenContainerView.swift`, `RuneScreenViewController.swift`, `RuneScreensNavigationController.swift`, `SNUIManager+RuneScreens.m` – embed `UINavigationController`, map props/handlers, dispatch events back to JS. |
| Prop flow | `ScreenProps` already include `headerOptions`, `onNativeBack`, style overrides. We’ll extend a similar pattern for tab chrome. |

Key pattern to reuse:
1. JS -> host component via props (e.g., `headerOptions`, `active`).
2. Native view translates props into UIKit state.
3. Native events → JS callbacks (`onNativeBack`) so the memory router updates its state.

## Desired Bottom Tabs Behavior

1. The JS `TabsNavigator` should keep full control of the navigation state (which tab is focused, nested stacks, etc.).
2. On iOS we render a single `UITabBarController` (or a custom `UITabBar`) that hosts the content views provided by JS, just like we host stack content inside `UINavigationController`.
3. Tab bar configuration (items, titles, icons, badges, tint, background/blur, visibility) is driven via props passed through `rune-screen-tabs-container` (or a new primitive).
4. Selecting a tab in the native bar should notify JS so the memory router updates `selectedIndex`.
5. Per-tab content should continue to be Solid routes; JS should not need to know about `UITableViewController` etc.
6. Android stays the same (JS header, etc.) so the new behavior is iOS-only for now.

## Proposed Architecture

### JS Side

1. **Extend `ScreenTabsContainer` / Tabs navigator props**  
   - Add tab bar options (`tabs?: Array<{ label, icon, badge, ... }>`).  
   - Add `onNativeTabSelect` callback that we pass to the primitive (mirroring `onNativeBack`).
2. **Detect platform**  
   - On iOS, hide the current JS tab bar UI (similar to `shouldRenderHeaderBar`).  
   - Pass tab bar config down via a new prop (e.g., `tabBarOptions`) so the native view can build the native bar.
3. **Handle native selection**  
   - When the native bar fires `onNativeTabSelect(index)`, call the same helpers used by JS tab buttons (`helpers.navigate`/`setIndex`).  
   - Keep existing JS tab UI for Android.

### Native Side

1. **New host view**  
   - Introduce `RuneTabsContainerView` (Swift) that embeds a `UITabBarController`.  
   - Manage an array of tabs, each tab hosting a `UIViewController` whose view is the JS-provided tab content (similar to `RuneScreenViewController`).  
   - Keep references between Solid nodes and tab controllers so we can update titles/badges.
2. **Prop parsing** (`SNUIManager+RuneScreens.m` or a new Obj-C bridge file)  
   - Extend `rune-screen-tabs-container` descriptor to accept `tabBarOptions` and `onNativeTabSelect`.  
   - Parse arrays of tab descriptors.
3. **Event bridge**  
   - When UIKit `UITabBarController` delegate reports a new selection, invoke the JS handler (`onNativeTabSelect`).  
   - Handle programmatic changes (JS sets `selectedIndex`) by calling `setSelectedIndex` on the native controller; suppress the delegate callback so we don’t loop.
4. **Styling**  
   - Support core properties: background blur (translucent), tint colors, icon rendering (`SF Symbols` names, asset names, or custom images).  
   - Provide safe defaults so the native bar looks correct even if JS doesn’t specify anything.
5. **Animation / interaction**  
   - Let UIKit drive transitions; we just swap child view controllers for tab content.  
   - Optional: allow per-tab stack controllers to coexist (host each tab’s root view inside our existing stack container if we want nested stacks later).

## File Checklist

- JS: `packages/rune-memory-router/src/navigators/Tabs.tsx` (or wherever the tab navigator lives), `ScreenTabsContainer.tsx`, typings (`types.ts`, `jsx.d.ts`).
- Native Swift: new files under `packages/rune-screens/ios/src/` for tab container, tab view controllers, bridging helpers.
- Obj-C bridge: `SNUIManager+RuneScreens.m` (extend existing descriptor) or a new category if it starts getting too large.
- Documentation: update this doc as implementation progresses; add final API docs to `docs/router` or package README.

## Implementation Steps (High Level)

1. **JS/Type additions**
   - Define `ScreenTabOptions` interface (label, icon, badge, accessibility label, etc.).
   - Update `ScreenTabsContainerProps` to carry `tabBarOptions` and `onNativeTabSelect`.
   - Update Tabs navigator to build that options object and hide JS tab UI on iOS.
2. **Native view/controller**
   - Create `RuneTabBarControllerHost` that embeds `UITabBarController`, manages items, and hosts child controllers.
   - Mirror the stack pattern: each tab’s content view is provided by JS and wrapped in a view controller (`RuneTabContentViewController`).
3. **Prop bridging**
   - Update `SNUIManager+RuneScreens` to parse `tabBarOptions` JSON and pass it to the host view (`setTabItems`, `setSelectedIndex`).  
   - Add `onNativeTabSelect` handler support (store handler ID, invoke when the delegate fires).
4. **JS-native synchronization**
   - When JS sets `selectedIndex`, call native `setSelectedIndex` (without triggering JS callback).  
   - When native selection changes, call `onNativeTabSelect` so JS updates its navigation state.
5. **Testing**
   - Verify initial tab selection, switching tabs, badges, icons, colors, and nested navigation stacks within tabs.  
   - Ensure Android path is unaffected.

Keep this document close when we start that work; it captures the current stack wiring and the exact points we’ll extend for tabs. Feel free to expand with notes or decisions as implementation progresses.
## Status Update – Native Tab Bar MVP

- `ScreenTabsContainer` now forwards tab metadata/options so the iOS runtime can host a native Liquid Glass tab bar alongside the JS-driven screens. The navigator disables the JS tab bar on iOS while keeping Android behavior untouched.
- `ScreenTabsContainer` embeds a real `UITabBarController`, so JS tabs map to native view controllers and we get the system Liquid Glass bar, badges, and transitions automatically. JSX tab icons render through Solid surfaces that sit on top of the native bar (mirroring the Stack header accessory approach), keeping Android and iOS icon APIs aligned.
- `RuneScreenTabsContainerView` embeds a custom native tab bar built with UIKit blur effects plus bidirectional events, so native selections notify JS (`onNativeTabSelect`) and programmatic index changes stay in sync.
