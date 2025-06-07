# iOS Tab Surface Stabilization & Architecture Fixes

**Date:** November 23, 2025
**Status:** Solved but with issues

## Executive Summary

This document details the resolution of critical rendering issues in the iOS Bottom Tab Router implementation. The system suffered from race conditions, icon flickering, state corruption (swapped icons), and inconsistent active state synchronization between the JavaScript router and the iOS Native Surface architecture.

The final solution involves a robust "State Locking" mechanism where the JavaScript side enforces the active state, combined with synchronous rendering strategies to guarantee visual updates.

## The Problems

### 1. Missing Initial Icons & Race Conditions

- **Symptom:** The initial tab icon (e.g., Home) would often fail to render on boot, resulting in a blank tab.
- **Cause:** The `Tabs.tsx` component was creating new function references for icons on every render. This triggered a "Dispose -> Re-register" cycle for every tab during initialization. The Native side, detecting a change, aggressively tore down the view surface (`SNUIManager`) before the new one could be mounted, leading to a race condition where the view was disposed mid-render.

### 2. Flickering & Infinite Loops

- **Symptom:** Switching tabs caused all icons to blink or flicker.
- **Cause:** The `createEffect` responsible for generating `nativeConfig` depended on `activeKey`. Switching tabs changed the `activeKey`, which triggered a regeneration of the config and a call to `setNativeTabs`. This caused the Native side to rebuild the entire Tab Bar controller needlessly. Additionally, circular dependencies between `selectNativeTab` and native events caused infinite update loops.

### 3. Icon Swapping (The "Search becomes Profile" Bug)

- **Symptom:** Tapping a tab would sometimes cause icons to swap (e.g., the Search tab displaying the Profile icon).
- **Cause:** The `buildRouteRecords` function was preserving `tabOptions` (including the icon factory) from previous route records to handle HMR/re-mounting. However, this cache could become stale or mismatched if routes were re-ordered or if the component provided updated options. This led to the Router assigning the wrong icon factory to a route index.

### 4. Active State Desynchronization & "Ghost" States

- **Symptom:** Tabs would remain visually active after switching away, or become active when they shouldn't. Icons would sometimes disappear completely during transitions.
- **Cause:**
  - **Async Reactivity:** SolidJS fine-grained updates (signals) are asynchronous (microtask). By the time the effect ran to update the icon color, the `runWithSurface` context had already exited, causing the update to be applied to the wrong surface (or lost entirely).
  - **Native Conflicts:** The Native side (`RNTabsHostController`) appeared to be recycling views or sending `isActive=true` signals for the _previous_ tab during transitions, fighting against the JS state.

## The Solution Architecture

### 1. Stabilizing the Router (`Tabs.tsx`)

- **Memoized Routes:** The `routes` list is now derived via `createMemo`, ensuring it is stable and only updates when `registeredNames` actually changes.
- **Stale Data Cleanup:** `buildRouteRecords` was modified to **never** preserve `tabOptions` from the previous record. It always fetches the fresh options from the `ScreenDescriptor`, preventing icon swapping.
- **Decoupled Effects:**
  - **Icon Registration:** A dedicated effect handles registering/unregistering icons with deterministic IDs (`navigatorId:index:routeName`). It only acts when the factory reference actually changes.
  - **Native Config:** A separate effect handles `setNativeTabs`. It uses `JSON.stringify` to ensure the config is only sent to Native when it truly changes, preventing flickering.
- **Loop Breaking:** The `updateActiveRoute` function now accepts a `fromNative` flag. Updates originating from Native events (taps) do **not** call `selectNativeTab` back, preventing the update loop.

### 2. Synchronous Rendering (`tabIconRenderer.tsx`)

- **Manual Re-rendering:** We abandoned SolidJS signals for the active state. Instead, `renderTabIcon` uses a manual "Dispose & Re-render" strategy.
  - When state changes, it synchronously disposes the previous Root and creates a new one.
  - This ensures the render happens **inside** the `runWithSurface` block, guaranteeing the Native commands target the correct Surface ID.
  - This fixes the "invisible icon" and "context loss" issues.

### 3. State Locking (`Active State Authority`)

- **Problem:** Native side sometimes reports the wrong active state (e.g., keeping the old tab active).
- **Fix:** We implemented a **Locking Mechanism**.
  - `MountedIcon` now has a `targetActive` property.
  - When the Router switches tabs (`Tabs.tsx`), it iterates **all** routes and calls `updateTabIconActiveState`, explicitly setting `true` for the new tab and `false` for all others.
  - This sets the `targetActive` lock.
  - The `renderTabIcon` function checks this lock. If Native tries to render with `isActive=true` but the lock says `false`, the Lock wins.
  - **Result:** JavaScript is the Single Source of Truth. Native side inconsistencies are overridden.

## Why It Works

This combination ensures:

1.  **Stability:** No unnecessary Native updates (no flickering).
2.  **Correctness:** Icons are always fresh and matched to the correct route (no swapping).
3.  **Visibility:** Rendering is synchronous and context-aware (no invisible icons).
4.  **Consistency:** The JS Router enforces the active state aggressively, ignoring any "noise" from the Native view recycling logic.
