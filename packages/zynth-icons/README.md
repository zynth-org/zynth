# Icons

`Icons` provides a high-performance, font-based icon library for Zynth applications, offering access to over 20,000 vector icons from popular sets such as Bootstrap Icons (`bs`), Font Awesome (`fa`), Heroicons (`hi`), and more.

By utilizing optimized icon fonts and the native `Text` primitive, `Icons` ensures a minimal memory footprint and perfect integration with the framework's typography system. Each icon acts as a standard Zynth node, enabling reactive styling, accessibility support, and hardware-accelerated rendering on all platforms.

## Basic usage

Icons are categorized into sets and should be imported from their respective subpaths (e.g., `@zynth/icons/bs`) for optimal tree-shaking and performance. Since they are based on the `Text` primitive, they are styled using standard typography properties.

```tsx
import { View } from "@zynth/components";
import { BsArchive, BsBellFill } from "@zynth/icons/bs";

const App = () => {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      {/* Icons inherit color and fontSize like any Text component */}
      <BsArchive style={{ color: "#0F172A", fontSize: 24 }} />
      <BsBellFill style={{ color: "#EF4444", fontSize: 24 }} />
    </View>
  );
};
```

## Important and advanced examples

### Integrating with UI Components

Icons are frequently used within other Zynth primitives like `Button` or `Menu` to provide visual context.

```tsx
import { Menu, View } from "@zynth/components";
import { BsArchive } from "@zynth/icons/bs";

const ActionItem = () => {
  return (
    <Menu.Item
      label="Archive draft"
      onPress={() => console.log("Archived!")}
      icon={<BsArchive style={{ color: "#FFFFFF", fontSize: 20 }} />}
    />
  );
};
```

### Reactive Styling

Because icons utilize the underlying typography system, their appearance can be dynamically updated using SolidJS signals or Shared Values.

```tsx
import { createSignal } from "solid-js";
import { HiHeart } from "@zynth/icons/hi";

const ToggleHeart = () => {
  const [isActive, setIsActive] = createSignal(false);

  return (
    <HiHeart 
      onPress={() => setIsActive(!isActive())}
      style={{ 
        color: isActive() ? "#EF4444" : "#94A3B8", 
        fontSize: 32 
      }} 
    />
  );
};
```

## Special cases and notes

- **Web Support**: The package automatically injects necessary CSS `@font-face` rules for all used icon sets when running in a web environment.
- **Performance**: While thousands of icons are available, only the fonts for the icon sets actually imported in your code will be loaded into the device memory.

## API Reference

**Exports:** Over 20,000 icon components (e.g., `BsArchive`, `HiHeart`, `FaUser`) across various sets.

**Import Pattern**

Import icons from the appropriate set to keep your bundle size small:
- `@zynth/icons/ai` — Ant Design
- `@zynth/icons/bs` — Bootstrap Icons
- `@zynth/icons/fa` — Font Awesome
- `@zynth/icons/hi` — Heroicons
- `@zynth/icons/io` — Ionicons
- `@zynth/icons/ri` — Remix Icon
- `@zynth/icons/tb` — Tabler Icons
- (See `src/` for the full list of sets including `bi`, `cg`, `fi`, `im`, `oc`, `si`, `ti`, `vs`, `wi`)

**Props**

Each icon component accepts all standard `Text` props, including:
- `style` — Supports `color`, `fontSize`, `opacity`, `margin`, etc.
- `onPress` — Tap interaction handler.
- `onLongPress` — Long press interaction handler.

---

This package provides a scalable and efficient way to add visual iconography to your Zynth applications. For custom iconography beyond these sets, consider using `createIcon` to register your own icon fonts.