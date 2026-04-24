# View

`View` is the fundamental container in Zynth, mapping directly to `UIView` on iOS and `ViewGroup` on Android. It is the core building block for layouts and supports high-performance native styles, integrated gestures, and motion transitions.

## Basic Usage

`View` behaves like a standard container with flexbox layout support powered by Yoga.

```tsx
import { View, Text } from "@zynthjs/components";

function Layout() {
  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: "#f5f5f5" }}>
      <Text>Hello Zynth</Text>
    </View>
  );
}
```

## Motion & Transitions

One of the most powerful features of `View` is its native support for entry, exit, and layout animations without requiring extra wrappers.

```tsx
import { View } from "@zynthjs/components";
import { FadeIn, FadeOut, LinearTransition } from "@zynthjs/core/motion";

function AnimatedList({ items }) {
  return (
    <View style={{ gap: 8 }}>
      <For each={items}>
        {(item) => (
          <View 
            entering={FadeIn} 
            exiting={FadeOut}
            layout={LinearTransition}
            style={{ height: 50, backgroundColor: "#fff" }}
          >
            <Text>{item.text}</Text>
          </View>
        )}
      </For>
    </View>
  );
}
```

## Integrated Gestures

Gestures can be attached directly to a `View` using the `gesture` prop. This wires native recognizers to the view's host node on the UI thread.

```tsx
import { View } from "@zynthjs/components";
import { createPanGesture } from "@zynthjs/core/gesture";

function Draggable() {
  const pan = createPanGesture({
    onUpdate: (e) => {
      // Worklet-driven update
      offset.value = e.translationX;
    }
  });

  return (
    <View 
      gesture={pan}
      style={{ width: 100, height: 100, borderRadius: 12 }} 
    />
  );
}
```

## Props

| Prop | Type | Description |
|---|---|---|
| `style` | `StyleProp` | Standard or animated styles. |
| `entering` | `EntryExitAnimationLike` | Animation to run when the view mounts. |
| `exiting` | `EntryExitAnimationLike` | Animation to run before the view unmounts. |
| `layout` | `LayoutTransitionLike` | Transition to apply when bounds change. |
| `gesture` | `GestureDefinition[]` | Native gesture recognizers to attach. |
| `visible` | `boolean` | Controls visibility with automatic enter/exit triggers. |
| `pointerEvents`| `auto` \| `none` \| `box-none` \| `box-only` | Controls touch propagation behavior. |
| `onLayout` | `(event) => void` | Called when the view's frame is measured. |
| `enableGlassIOS`| `boolean` | Enables native SF Symbol glass effects on iOS. |
| `testID` | `string` | Identifier for automated testing. |

