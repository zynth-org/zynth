# SolidJS 2.0 Primitives Migration Guide & Inventory

## 📌 Overview
This document provides the standard migration blueprint and complete inventory for converting Zynth UI primitive components (`packages/zynth-components/src/primitives/`) to be 100% compliant with **SolidJS 2.0 (beta 23)** and the `@solidjs/universal` custom renderer architecture.

---

## 🚨 Root Cause Analysis

### 1. Dynamic Attribute Expressions on Intrinsic Tags
- **Problem**: Dynamic inline attribute expressions on intrinsic JSX tags (e.g. `<view style={resolvedStyle()} testID={local.testID}>`) trigger `@solidjs/universal` attribute effects that clash with observer contexts (`Cannot read property 'e' of undefined`). Furthermore, relying solely on reactive effects for initial prop delivery causes initial renders to miss properties because `hostNode` is initially `null` when effects setup phase executes.
- **Solution**:
  - Keep intrinsic JSX tags clean without dynamic inline attribute expressions: `<view ref={refProp}>{props.children}</view>`.
  - Extract a helper `applyComponentProps(node: HostNode)` that applies all native properties (`setProperty`).
  - Apply initial properties **synchronously** inside `refProp(node)` when `HostNode` is created.
  - Perform subsequent reactive updates **imperatively** inside 2-argument `createEffect`.

### 2. Mandatory 2-Argument `createEffect`
- **Problem**: In SolidJS 2.0 (`@solidjs/signals`), single-argument `createEffect(compute)` is deprecated and returns `never`.
- **Solution**: Always use the mandatory 2-argument signature `createEffect(compute, effectFn)`:
  ```ts
  createEffect(
    () => ({ st: resolvedStyle(), disabled: local.disabled }),
    () => {
      const node = hostNode();
      if (node) applyComponentProps(node);
    }
  );
  ```

### 3. Removal of `JSX.Element`
- **Problem**: `JSX.Element` was removed from `solid-js` types in Solid 2.0.
- **Solution**: Import `Element as SolidElement` from `"solid-js"`.

---

## 🛠 Standard Component Pattern (Before vs. After)

### ❌ BAD (SolidJS 1.x Legacy - Crashes or Missing Props in Solid 2.0 Universal):
```tsx
export const MyComponent = (props) => {
  const resolvedStyle = createStyle(() => props.style);

  // ❌ 1-arg createEffect (deprecated/never in Solid 2.0)
  createEffect(() => {
    doSomething();
  });

  return (
    // ❌ Dynamic inline attribute expressions generate @solidjs/universal attribute effects
    // which clash with observer contexts
    <view style={resolvedStyle()} layout={props.layout} testID={props.testID}>
      {props.children}
    </view>
  );
};
```

---

### ✅ GOOD (SolidJS 2.0 Universal Compliant & Zero Latency):
```tsx
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { ParentComponent, Element as SolidElement } from "solid-js";
import type { HostNode } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";
import { createStyle } from "../hooks/createStyle";

export const MyComponent: ParentComponent<MyProps> = (props) => {
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const resolvedStyle = createStyle(() => props.style);

  // Helper to apply properties to native HostNode
  const applyComponentProps = (node: HostNode) => {
    const st = resolvedStyle();
    if (st != null) setProperty(node, "style", st);
    if (props.layout != null) setProperty(node, "layout", props.layout);
    if (props.testID !== undefined) setProperty(node, "testID", props.testID);
  };

  // 1. Apply initial properties SYNCHRONOUSLY in refProp on node creation
  const refProp = (node: HostNode | null) => {
    if (node) {
      applyComponentProps(node);
      setHostNode(node);
      props.ref?.(node);
      return;
    }
    setHostNode(null);
    props.ref?.(null);
  };

  // 2. Perform subsequent reactive updates IMPERATIVELY via 2-argument createEffect
  createEffect(
    () => ({
      st: resolvedStyle(),
      layout: props.layout,
      testID: props.testID,
    }),
    () => {
      const node = hostNode();
      if (node) applyComponentProps(node);
    }
  );

  onCleanup(() => {
    setHostNode(null);
  });

  // 3. Keep intrinsic tag clean without dynamic inline attribute expressions
  return (
    <view ref={refProp}>
      {props.children}
    </view>
  );
};
```

---

## 📋 Monorepo Primitive Components Audit & Migration Status

| Component Path | Status | Migration Action Required |
| :--- | :--- | :--- |
| `packages/zynth-components/src/primitives/Text.tsx` | ✅ **DONE** | Fully migrated with `extractTextContent` & `refProp` sync. |
| `packages/zynth-components/src/primitives/View.tsx` | ✅ **DONE** | Fully migrated with synchronous `refProp` & 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/Pressable.tsx` | ✅ **DONE** | Moved inline `<pressable>` attributes to `refProp` sync. |
| `packages/zynth-components/src/primitives/TextInput.tsx` | ✅ **DONE** | Moved inline `style` attributes to `refProp` sync. |
| `packages/zynth-components/src/primitives/TextField.tsx` | ✅ **DONE** | Moved inline `<text-field>` attributes to `refProp` sync. |
| `packages/zynth-components/src/primitives/Image.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/ScrollView.tsx` | ✅ **DONE** | Moved `testID` to `refProp` sync. |
| `packages/zynth-components/src/primitives/BottomSheet.tsx` | ✅ **DONE** | Moved `style` to `refProp` sync in `attachHost`. |
| `packages/zynth-components/src/primitives/Modal.tsx` | ✅ **DONE** | Moved `style` to `refProp` sync in `attachHost`. |
| `packages/zynth-components/src/primitives/Popover.tsx` | ✅ **DONE** | Moved all inline attributes to `refProp` sync. |
| `packages/zynth-components/src/primitives/GestureDetector.tsx` | ✅ **DONE** | Moved all inline attributes to `refProp` sync. |
| `packages/zynth-components/src/primitives/Alert.tsx` | ✅ **DONE** | Already compliant (no inline attributes on intrinsic elements). |
| `packages/zynth-components/src/primitives/Button.tsx` | ✅ **DONE** | Moved `testID` to `refProp` sync. |
| `packages/zynth-components/src/primitives/DatePicker.tsx` | ✅ **DONE** | Moved all inline attributes to `refProp` sync. |
| `packages/zynth-components/src/primitives/BlurView.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/GlassView.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/GlassContainer.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/Slider.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/Switch.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/Menu.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect` for all sub-components. |
| `packages/zynth-components/src/primitives/SafeAreaView.tsx` | ✅ **DONE** | Uses `View` (already migrated); no changes needed. |
| `packages/zynth-components/src/primitives/ScrollController.tsx` | ✅ **DONE** | No JSX, pure class — no changes needed. |
| `packages/zynth-components/src/primitives/StatusBar.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/ProgressIndicator.tsx` | ✅ **DONE** | Full migration: added `hostNode`, `refProp`, 2-arg `createEffect`. |
| `packages/zynth-components/src/primitives/SystemGlyph.tsx` | ✅ **DONE** | Uses `Text` (already migrated); no changes needed. |
| `packages/zynth-components/src/primitives/SystemIcon.tsx` | ✅ **DONE** | Delegates to `Image` (already migrated); no changes needed. |
| `packages/zynth-components/src/primitives/FlatList.tsx` | ✅ **DONE** | Uses `View`/`ScrollView` (already migrated); nested bindings are clean. |
| `packages/zynth-components/src/primitives/VirtualList.tsx` | ✅ **DONE** | Uses `View`/`ScrollView` (already migrated); nested bindings are clean. |
