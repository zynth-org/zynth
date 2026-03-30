# Interpolation

Mapping reactive values from one coordinate space to another with precision and control.

Interpolation allows you to transform a raw Shared Value (like a scroll position or a gesture offset) into a different range (like opacity or scale) using a linear or extrapolated mapping.

## Basic usage

Use the `interpolate` utility within a `createAnimatedStyle` or as a standalone signal transformer.

```tsx
import { interpolate, Extrapolation, createAnimatedStyle } from "@zynth/animate";

const offset = createSharedValue(0);

const animatedStyle = createAnimatedStyle(() => {
  const opacity = interpolate(
    offset.value,
    [0, 100],      // Input range
    [0, 1],        // Output range
    Extrapolation.CLAMP
  );

  return { opacity };
});
```

## Advanced

### Extrapolation Strategies

The `Extrapolation` object defines how values outside the specified input range are handled:

- **`CLAMP`**: Constrains the output to the boundaries of the `outputRange`. This is the most common strategy for discrete UI transitions.
- **`EXTEND`**: Continues the linear calculation beyond the output range boundaries. 
- **`IDENTITY`**: Returns the input value directly if it's outside the specified range.

```ts
interpolate(val, [0, 1], [0, 100], {
  extrapolateLeft: Extrapolation.CLAMP,
  extrapolateRight: Extrapolation.EXTEND
});
```

## Special cases

- **Multi-point Interpolation**: You can provide more than two points in the `inputRange` and `outputRange` to create non-linear, segmented mappings (e.g., a "bouncing" opacity pulse).
- **Native Implementation**: When used inside `createAnimatedStyle`, `interpolate` calls are offloaded to the native JSI bridge, allowing for zero-latency mapping of high-frequency events like scroll offsets.

## API Reference

### `interpolate(value, inputRange, outputRange, strategy?)`
Calculates an output value based on linear mapping.
- **Parameters**:
  - `value: number`: The source value (typically from a `SharedValue`).
  - `inputRange: number[]`: An array of strictly increasing numbers.
  - `outputRange: number[]`: An array with the same number of elements as `inputRange`.
  - `strategy?: Extrapolation | InterpolationConfig`

### `Extrapolation` Enum
- `CLAMP`: Maps to `"clamp"`
- `EXTEND`: Maps to `"extend"`
- `IDENTITY`: Maps to `"identity"`
