# Components & Hooks

The `@zynthjs/ui` package provides a suite of intelligent, theme-aware components built on top of the native primitives from `@zynthjs/components`. These components automatically adapt to your application's design system, handling typography, spacing, semantic colors, and platform-specific aesthetic differences out-of-the-box.

### Base Components Overview

For comprehensive API references on layout props (e.g., `style`, `onPress`, `accessibilityLabel`), please refer to the corresponding underlying `<View>`, `<Text>`, and input primitives in `@zynthjs/components`. The UI package acts as an intelligent styling wrapper that extends those core capabilities.

---

## Unique Components

These components are specifically structured within `@zynthjs/ui` to compound raw primitives into fully realized design-system patterns.

### Card

The `Card` component is a foundational container that applies standard theming to a `View` structure. It serves as a bounded surface for content.

```tsx
import { Card, Text } from "@zynthjs/ui";

function Example() {
  return (
    <Card variant="elevated" padding="lg">
      <Text variant="subheading">Card Title</Text>
      <Text color="muted">This is an elevated card with large padding.</Text>
    </Card>
  );
}
```

**Props:**
* `variant` (`"elevated" | "outlined" | "flat"`): Determines the shadow, border, and background color logic. Defaults to `"elevated"`.
* `padding` (`"none" | "sm" | "md" | "lg"`): Semantic padding mapped directly to `theme().spacing`. Defaults to `"md"`.

### Badge

The `Badge` component is great for status indicators, counts, or semantic labeling.

```tsx
import { Badge } from "@zynthjs/ui";
import { View } from "@zynthjs/components";

function Example() {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Badge color="success" variant="solid" label="Completed" />
      <Badge color="warning" variant="outline" label="Pending" />
      <Badge color="danger" variant="soft" label="Error" />
    </View>
  );
}
```

**Props:**
* `color` (`"accent" | "success" | "warning" | "danger" | "info" | "neutral"`): Semantic color tone.
* `variant` (`"solid" | "outline" | "soft"`): Visual hierarchy styling.
* `label` (`string`): The text to display.

### Radio & Checkbox

These are theme-aware, accessible binary input controls. They utilize the framework's touch handling and handle focus states and platform-specific interactions cleanly.

```tsx
import { Radio, Checkbox } from "@zynthjs/ui";
import { createSignal } from "solid-js";

function Example() {
  const [checked, setChecked] = createSignal(false);
  const [radioValue, setRadioValue] = createSignal("option1");

  return (
    <>
      <Checkbox 
        checked={checked()} 
        onChange={setChecked} 
        label="Accept Terms and Conditions"
        color="accent" 
      />
      
      <Radio 
        selected={radioValue() === "option1"} 
        onSelect={() => setRadioValue("option1")} 
        label="Option 1"
        color="success" 
      />
      <Radio 
        selected={radioValue() === "option2"} 
        onSelect={() => setRadioValue("option2")} 
        label="Option 2"
        color="success" 
      />
    </>
  );
}
```

**Props (Checkbox & Radio):**
* `checked` / `selected` (`boolean`): The active state of the control.
* `onChange` / `onSelect` (`(checked: boolean) => void` / `() => void`): Callback when the user interacts with the control.
* `label` (`string`): Built-in text label that is interactive alongside the control button.
* `color` (`string`): Theme color mapping for the active/checked state.

### QRCode

A native QR code renderer styled seamlessly with `@zynthjs/ui` tokens. It guarantees high-performance rendering without web-based or heavy third-party polyfills, hooking directly into platform layout parameters.

```tsx
import { QRCode } from "@zynthjs/ui";

function Example() {
  return (
    <QRCode 
      value="https://zynthai.com/zynth" 
      size={200}
      color="#000000"
      backgroundColor="#FFFFFF"
    />
  );
}
```

**Props:**
* `value` (`string`): The data payload for the QR code.
* `size` (`number`): Fixed dimensions of the generated code block.
* `color` / `backgroundColor` (`string`): Accept standard or semantic theme color strings.

---

## Hooks

The UI package exposes a minimal set of highly efficient hooks to interact with your design system. 

### `useUITheme()`
Returns an Accessor to the current complete `UITheme` object. Because it returns an Accessor, you should call it as a function (`theme()`) inside reactive tracking scopes (like SolidJS `createMemo` or inside JSX bindings) to ensure your component updates seamlessly when the user switches color modes.

```tsx
import { useUITheme } from "@zynthjs/ui";
import { View } from "@zynthjs/components";

function Layout() {
  const theme = useUITheme();

  return (
    <View style={{ backgroundColor: theme().colors.surface }}>
       {/* content */}
    </View>
  );
}
```

### `createUIColorScheme()`
A streamlined hook that strictly returns the active `"light"` or `"dark"` scheme string. Useful when you only need to branch logic based on dark mode, rather than extracting specific colors or typography tokens.

```tsx
import { createUIColorScheme } from "@zynthjs/ui";
import { Image } from "@zynthjs/components";

function Logo() {
  const scheme = createUIColorScheme();

  return (
    <Image 
      source={scheme() === "dark" ? require("./logo-white.png") : require("./logo-black.png")} 
    />
  );
}
```
