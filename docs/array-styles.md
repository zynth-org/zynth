# Array Styles Support

Rune now supports array styles for responsive and conditional styling while maintaining full SolidJS reactivity.

## Overview

Array styles allow you to pass multiple style objects that are merged left-to-right, with later values overriding earlier ones. This pattern is useful for:

- **Conditional styling**: Apply different styles based on state
- **Responsive styling**: Combine base styles with responsive overrides
- **Theme support**: Layer base theme + component + custom styles
- **Props merging**: Combine default styles with props

## Types

### `StyleProp`

Available from `@rune/core`:

```typescript
import type { StyleProp } from "@rune/core";

// A StyleProp can be either:
// - A single Style object
// - An array of Style objects (with undefined/null filtered out)
type StyleProp = Style | (Style | undefined | null)[];
```

## Hooks

### `useStyle`

Transform a `StyleProp` into a reactive `Style` object. Properly handles SolidJS's reactive system to avoid breaking responsiveness.

```typescript
import { useStyle } from "@rune/components";
import { createSignal } from "solid-js";

export const MyComponent = (props: { style?: StyleProp }) => {
  const style = useStyle(() => props.style);
  return <Text style={style()}>Hello</Text>;
};
```

### `mergeStyles`

Merge multiple style sources (including accessors) into a single reactive style.

```typescript
import { mergeStyles } from "@rune/components";
import { createSignal } from "solid-js";

export const MyButton = (props: { isActive?: boolean; style?: StyleProp }) => {
  const [isHovered, setIsHovered] = createSignal(false);

  const style = mergeStyles(
    // Base styles
    { paddingHorizontal: 16, paddingVertical: 8 },
    // Conditional styles from state
    () =>
      isHovered() ? { backgroundColor: "blue" } : { backgroundColor: "gray" },
    // Conditional styles from props
    () => (props.isActive ? { opacity: 1 } : { opacity: 0.5 }),
    // Custom styles from props
    () => props.style
  );

  return <Pressable style={style()}>Click me</Pressable>;
};
```

## Examples

### Simple Array Style

```tsx
<Text style={[{ color: "#FFF" }, props.customStyle]} />
```

### Conditional Styling

```tsx
<View
  style={[
    { flexDirection: "row", padding: 16 },
    isActive() ? { backgroundColor: "blue" } : { backgroundColor: "gray" },
  ]}
/>
```

### Responsive Styling with Hooks

```tsx
import { useStyle } from "@rune/components";
import { createSignal } from "solid-js";

export const ResponsiveCard = (props: { style?: StyleProp }) => {
  const [isWide, setIsWide] = createSignal(false);

  const style = useStyle(() => [
    // Base card styles
    { borderRadius: 8, padding: 16 },
    // Responsive override
    isWide() ? { width: "60%", marginHorizontal: "auto" } : { width: "100%" },
    // Custom styles
    props.style,
  ]);

  return <View style={style()}>Card content</View>;
};
```

### Theme + Component + Custom Styles

```tsx
import { mergeStyles } from "@rune/components";

const themeStyles = {
  primary: { backgroundColor: "#007AFF", color: "#FFF" },
  secondary: { backgroundColor: "#E5E5E5", color: "#000" },
};

export const ThemedButton = (props: {
  variant?: "primary" | "secondary";
  style?: StyleProp;
}) => {
  const style = mergeStyles(
    // Theme styles
    () => themeStyles[props.variant ?? "primary"],
    // Component base styles
    { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4 },
    // Custom prop styles
    () => props.style
  );

  return <Pressable style={style()}>Button</Pressable>;
};
```

## How It Works

Under the hood, array styles are merged using `createMemo` from SolidJS:

1. Array styles are flattened and merged left-to-right
2. Undefined and null values are filtered out
3. Each object's properties override previous values
4. The result is wrapped in `createMemo` to maintain reactivity
5. Component props changes automatically trigger style recalculation

This ensures that any reactive signals or memos used in your styles will automatically update the component when they change, maintaining SolidJS's fine-grained reactivity model.

## Performance

- Array merging happens inside `createMemo`, so it's cached and only recalculates when dependencies change
- No unnecessary re-renders or style recalculations
- Null/undefined values are efficiently filtered
- Shallow merge is used (appropriate for style objects)
