# Layout Transitions

> [!WARNING]
> Layout Transitions are currently experimental and may exhibit instability in complex layouts or during rapid state updates. Use with caution in development environments.

Automatically animate position and size changes across layout passes.

Layout Transitions in Zynth allow you to animate the movement of components that change their position or size due to state changes elsewhere in the application, such as adding items to a list or toggling a drawer.

## Basic usage

Apply a layout transition to an `AnimatedView` using a transition builder like `LinearTransition`.

```tsx
import { AnimatedView, LinearTransition } from "@zynth/animate";
import { For } from "solid-js";

function DynamicList(props) {
  return (
    <View>
      <For each={props.items}>
        {(item) => (
          <AnimatedView
            layout={LinearTransition.springify()}
            style={{ padding: 10, marginBottom: 5 }}
          >
            <Text>{item.text}</Text>
          </AnimatedView>
        )}
      </For>
    </View>
  );
}
```

## Advanced

### Spring-based Transitions

While linear transitions are standard, you can "springify" a transition to give layout shifts a more natural, organic feel.

```tsx
<AnimatedView layout={LinearTransition.duration(500).springify()}>
  {content}
</AnimatedView>
```

### Custom Durations

Control the speed of the layout adjustment to match the rhythm of your primary animations.

```tsx
LinearTransition.duration(200); // Fast and snappy
LinearTransition.delay(100); // Staggered response
```

## Special cases

- **Yoga Integration**: Layout transitions work by capturing the bounding box of a view before and after a Yoga layout pass. The native engine then interpolates between these snapshots during the subsequent frames.
- **Z-Index**: During transitions where elements cross paths, ensure your `zIndex` values are correctly set. By default, elements maintain their tree-order depth during layout animations.

## API Reference

### `LinearTransition` Builder

The primary builder for animating layout shifts.

- `duration(ms: number)`: Sets the transition time.
- `springify()`: Switches the interpolation from linear to spring physics.
- `delay(ms: number)`: Adds a delay before the transition begins.

### `LayoutTransitionConfig`

- `duration?: number`
- `spring?: boolean`
- `delay?: number`
- `damping?: number` (when springified)
- `stiffness?: number` (when springified)
