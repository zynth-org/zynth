# @zynth/ui

A cohesive, themeable UI component library for Zynth.

This package provides a set of high-level, opinionated components (`Card`, `Button`, `Badge`, etc.) built on top of `@zynth/components`. It includes a theming system to enforce design consistency across your application.

## Setup

Wrap your application root in `UIThemeProvider`.

```tsx
import { UIThemeProvider, createTheme } from "@zynth/ui";

const theme = createTheme({
  colors: {
    accent: "#6200ee",
    background: "#f5f5f5",
    // ...
  }
});

function App() {
  return (
    <UIThemeProvider theme={theme}>
      <MainScreen />
    </UIThemeProvider>
  );
}
```

## Components

### `Card`
A versatile container for grouping content.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `variant` | `'elevated' \| 'outlined' \| 'flat'` | `'elevated'` | Visual style of the card. |
| `padding` | `'none' \| 'sm' \| 'md' \| 'lg'` | `'md'` | Internal spacing. |

```tsx
import { Card, Text } from "@zynth/ui";

<Card variant="elevated" padding="lg">
  <Text>Card Content</Text>
</Card>
```

### `Button`
Extends the native `@zynth/components` Button with theme integration.

```tsx
import { Button } from "@zynth/ui";

<Button tone="primary" onPress={submit}>
  Submit
</Button>
```

### `Badge`, `Checkbox`, `Radio`, `Switch`, `TextInput`
Standard form components and indicators that automatically consume the current theme's palette (success, warning, danger, etc.).

## Hooks

### `useUITheme()`
Returns the current theme object.

```tsx
import { useUITheme } from "@zynth/ui";

const theme = useUITheme();
console.log(theme().colors.accent);
```