# AnimatedView

The primary component for hardware-accelerated animations in the Zynth framework.

`AnimatedView` is a drop-in replacement for the standard `View` component that provides first-class support for Shared Values, entry/exit animations, and layout transitions. It is optimized to perform layout and style updates directly on the native thread during animations.

## Basic usage

### Animating Styles

To animate styles, you must use `createAnimatedStyle` to create a reactive mapping between your Shared Values and the view's style properties.

```tsx
import { AnimatedView, createSharedValue, createAnimatedStyle, withSpring } from "@zynth/animate";

function ShakingBox() {
  const rotation = createSharedValue(0);

  const style = createAnimatedStyle(() => ({
    width: 100,
    height: 100,
    backgroundColor: "red",
    transform: [{ rotate: `${rotation.value}deg` }]
  }));

  const startShake = () => {
    rotation.value = withSpring(45);
  };

  return <AnimatedView style={style} onPress={startShake} />;
}
```

## Advanced

### Conditional Rendering with `visible`

The `visible` prop on `AnimatedView` allows you to toggle the visibility of a component with automatic support for `entering` and `exiting` animations. Unlike standard conditional rendering (`{isVisible() && <View />}`), `AnimatedView` will delay the unmounting of the component until the exit animation finishes.

```tsx
<AnimatedView 
  visible={isShown()}
  entering={FadeIn}
  exiting={FadeOut}
>
  <Text>I fade in and out gracefully.</Text>
</AnimatedView>
```

## Special cases

- **Performance Tip**: Always prefer passing a Shared Value to `createAnimatedStyle` for frequently changing properties (like `opacity` or `transform`). This ensures the JS thread is never blocked during complex animation sequences.
- **Reference Handling**: If you need access to the underlying host node, use the `ref` prop as you would with a normal `View`.

## API Reference

### `AnimatedView` Props

- **`style?: AnimatedStyleProp`**
  Supports standard styles, SolidJS accessors, and reactive mappers created via `createAnimatedStyle`.
- **`entering?: EntryExitAnimation`**
  Animation configuration for when the view mounts or becomes visible.
- **`exiting?: EntryExitAnimation`**
  Animation configuration for when the view unmounts or becomes hidden.
- **`layout?: LayoutTransition`**
  Configuration for automatically animating layout changes (position/size).
- **`visible?: boolean`**
  Reactive visibility toggle that triggers entry/exit sequences. Default is `true`.

### `createAnimatedStyle(getStyle: () => Style)`
Creates a high-performance style mapping that offloads updates to the native thread where possible.
- **Returns**: `Accessor<Style>` (Compatible with `AnimatedView`'s `style` prop).
