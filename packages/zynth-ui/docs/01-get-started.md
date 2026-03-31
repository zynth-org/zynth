# Get Started

The UI kit is a foundational package that provides essential primitives and a comprehensive design system for building native Zynth applications. It bridges the gap between low-level core components and high-level UI patterns, offering a set of consistent, themeable building blocks that adapt to platform-specific behaviors.

### UIProvider

The `UIProvider` (or `UIThemeProvider`) is the primary entry point for the UI kit. It initializes the design system, manages system appearance listeners, and provides the current theme context to all descendant components. For most applications, this should be placed at the very root of your component tree.

### Basic Usage

To start using the UI kit, wrap your main application component with the `UIProvider`.

```tsx
import { UIProvider } from "@zynth/ui";
import { View, Text } from "@zynth/components";

function App() {
  return (
    <UIProvider colorScheme="system">
      <View>
        <Text>Hello, Zynth+SolidJS!</Text>
      </View>
    </UIProvider>
  );
}
```

### Advanced Implementation

You can nest multiple providers to create themed sections within your application. Each descendant component will consume the theme from the nearest parent provider.

```tsx
import { UIProvider, Button, Text } from "@zynth/ui";
import { View } from "@zynth/components";

function NestedTheming() {
  return (
    <UIProvider colorScheme="light">
      <View style={{ padding: 20, backgroundColor: "white" }}>
        <Text>Standard Light Section</Text>
        
        <UIProvider colorScheme="dark">
          <View style={{ padding: 20, backgroundColor: "#121212" }}>
            <Text>Nested Dark Section</Text>
            <Button title="Action" />
          </View>
        </UIProvider>
      </View>
    </UIProvider>
  );
}
```

### Accessing Theme with Hooks

The UI kit provides hooks to access the current theme and color scheme reactively within your components.

```tsx
import { useUITheme, createUIColorScheme } from "@zynth/ui";
import { View } from "@zynth/components";
import { createMemo } from "solid-js";

function CustomComponent() {
  const theme = useUITheme();
  const scheme = createUIColorScheme();

  const dynamicStyle = createMemo(() => ({
    backgroundColor: theme().colors.accent,
    padding: theme().spacing.md,
    borderRadius: theme().radii.lg,
  }));

  return (
    <View style={dynamicStyle()}>
      <Text>Content in {scheme()} mode</Text>
    </View>
  );
}
```

### Special Cases

#### Web Compatibility
On Web platforms, the `UIProvider` automatically injects CSS variables into the document body to handle theming. This allows components to use standard CSS properties while remaining synchronized with the framework's reactive state. You can force a specific platform aesthetic on the web using the `webTheme` prop.

```tsx
<UIProvider webTheme="ios">
  {/* Elements will render with iOS-inspired CSS variables */}
</UIProvider>
```

#### System Appearance
Zynth UI kit monitors system-level appearance changes via native modules on iOS and Android. When `colorScheme="system"` is used, the framework automatically updates the UI tokens whenever the user toggles dark mode at the OS level.

### API Reference

| Prop | Type | Description |
| :--- | :--- | :--- |
| `children` | `JSX.Element` | The content to be wrapped. |
| `theme` | `UIThemeOverride` | A partial theme object to override default tokens. |
| `colorScheme` | `"light" \| "dark" \| "system"` | Initial color scheme mode. Defaults to `"system"`. |
| `followSystem` | `boolean` | Whether to react to OS-level appearance changes. |
| `webTheme` | `"ios" \| "android"` | Forces a platform-specific aesthetic on Web builds. |
