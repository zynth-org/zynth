# SafeArea

The `SafeArea` API handles screen insets to account for notches, home indicators, and system bars, ensuring your content is never clipped by hardware features.

Zynth provides a full suite of safe area primitives, including a context provider, reactive hooks, and a specialized `SafeAreaView` component.

## Basic usage

### SafeAreaProvider

You must wrap your application root with the `SafeAreaProvider`. This component tracks the system insets and broadcasts them to the rest of the tree.

```tsx
import { SafeAreaProvider } from "@zynth/apis";

function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}
```

### SafeAreaView

The most convenient way to handle insets is using the `SafeAreaView` component. It automatically adds padding or margins to its container to stay clear of system UI.

```tsx
import { SafeAreaView } from "@zynth/apis";

function Header() {
  return (
    <SafeAreaView edges={["top", "left", "right"]}>
      <View>
        <Text>Standard Header Content</Text>
      </View>
    </SafeAreaView>
  );
}
```

## Advanced

### Reactive Insets (Hooks)

For complex custom layouts where a simple view is not enough, use `createSafeAreaInsets()` to receive a reactive inset binding.

```tsx
import { createSafeAreaInsets } from "@zynth/apis";

function CustomNav() {
  const insets = createSafeAreaInsets();

  return (
    <View style={{ height: 60 + insets.top }}>
      <Text>Offset by Status Bar</Text>
    </View>
  );
}
```

## Special cases

- **Modes**: `SafeAreaView` supports two modes:
  - `padding`: Adds insets as internal padding (default).
  - `margin`: Adds insets as external margins.
- **Initial Metrics**: `getInitialWindowMetrics()` is available to provide inset snapshots before the first render loop, helping to prevent "jumpy" layouts on app startup.
- **Web Support**: On the web, safe area insets default to `0` unless specific CSS environment variables (`content-box`) are detected by the host.

## API Reference

### `<SafeAreaView />` Props

- `edges?: Array<'top' | 'right' | 'bottom' | 'left'>`
  Which sides of the view should account for insets.
- `mode?: 'padding' | 'margin'`
  How the insets should be applied to the style.
- `style?: Style`
  Base styles for the view.

### `createSafeAreaInsets(): SafeAreaInsets`
Returns a reactive binding object for current system insets. Property reads such as `insets.top` stay up to date in reactive contexts.

### `SafeAreaInsets` (Type)
- `top: number`
- `right: number`
- `bottom: number`
- `left: number`
