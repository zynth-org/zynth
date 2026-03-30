# Theme

The theme system is a robust and flexible token-based design architecture that provides consistent styling across all components. It manages colors, typography, spacing, and layout parameters, ensuring that your application maintains a coherent aesthetic while adapting to different platforms and color schemes.

### Theme Structure

The theme is organized into distinct categories of tokens:
- **Colors**: A predefined set of functional color names (e.g., `background`, `accent`, `surface`).
- **Typography**: Font family, weight, and size definitions.
- **Spacing**: A standardized scale for margins and padding.
- **Radii**: Corner border-radius values.
- **Sizes**: Standardized dimensions for common UI elements like icons and controls.

### Architecture

It is important to understand that components exported from `@zynth/ui` (such as `Button`, `Text`, or `Card`) are intelligent wrappers around the native primitives provided by `@zynth/components`. The UI package provides a more convenient way to use and customize these primitives by automatically applying the current theme, colors, typography, and interactive states. While `@zynth/components` provides the raw, unstyled native views, `@zynth/ui` provides the design system implementation.

### Basic Usage

The `useUITheme()` hook provides reactive access to the current theme object. This allows you to build custom components that stay synchronized with system overrides and color mode changes.

```tsx
import { useUITheme } from "@zynth/ui";
import { View } from "@zynth/components";
import { Text } from "@zynth/ui";

function CustomCard(props) {
  const theme = useUITheme();

  return (
    <View
      style={{
        backgroundColor: theme().colors.surface,
        padding: theme().spacing.md,
        borderRadius: theme().radii.md,
      }}
    >
      <Text style={{ color: theme().colors.text }}>
        {props.children}
      </Text>
    </View>
  );
}
```

### Advanced Theme Overrides

You can customize the entire look of your application by passing a `theme` override to the `UIProvider`. This object can be a partial representation of the theme tokens.

```tsx
import { UIProvider } from "@zynth/ui";

const customTheme = {
  colors: {
    accent: "#6200EE",
    success: "#03DAC6",
  },
  typography: {
    fontFamily: "Inter, system-ui",
  },
  radii: {
    md: 12,
  },
};

function Root() {
  return (
    <UIProvider theme={customTheme}>
      <App />
    </UIProvider>
  );
}
```

### Dynamic Theme Selection

For more advanced scenarios, the theme override is handled reactively. Any changes to the `theme` prop will propagate immediately through the application's UI.

```tsx
import { UIProvider, Button } from "@zynth/ui";
import { createSignal } from "solid-js";

function AppRoot() {
  const [rounded, setRounded] = createSignal(false);
  
  const themeOverride = () => ({
    radii: {
      md: rounded() ? 24 : 4,
    },
  });

  return (
    <UIProvider theme={themeOverride()}>
      <Button 
        title="Toggle Border Radius" 
        onPress={() => setRounded(!rounded())} 
      />
    </UIProvider>
  );
}
```

### Special Features

#### System Synchronization
On iOS and Android, the UI kit uses native listeners (`traitCollectionDidChange` and `onConfigurationChanged`) to detect appearance shifts. When the system appearance mode changes, the theme's `scheme` property and all associated colors and tokens are automatically updated.

#### Token Consistency
Tokens are defined in platform-neutral units (pixels or logical pixels). The UI kit handles necessary transformations between platforms to ensure that spacing and sizes remain visually consistent across all supported environments.

### API Reference: Theme Object

The `UITheme` object follows this hierarchical structure:

| Category | Token | Type | Description |
| :--- | :--- | :--- | :--- |
| **Common** | `scheme` | `"light" \| "dark"` | The currently active color mode. |
| **Colors** | `background` | `string` | Primary background color of views. |
| | `surface` | `string` | Secondary background for content blocks. |
| | `accent` | `string` | Brand or interactive element highlight color. |
| | `text` | `string` | Primary font color for readability. |
| | `border` | `string` | Color for dividers and outlines. |
| **Spacing** | `none` to `3xl` | `number` | A scale from `0` to `64` for layout spacing. |
| **Radii** | `none` to `full` | `number` | Corner radius definitions for containers. |
| **Sizes** | `iconSm` to `controlLg` | `number` | Dimensions for interactive control elements. |
| **Typography**| `fontFamily` | `string` | Base font family for text elements. |
| | `fontSizes` | `Scale` | Reactive scale of font sizes from `xs` to `3xl`. |
