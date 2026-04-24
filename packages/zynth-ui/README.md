# UI

The `@zynthjs/ui` package provides a responsive, robust design system and a suite of smart components built on top of the native primitives from `@zynthjs/components`. While `@zynthjs/components` exposes raw, unstyled native views mapping directly to Yoga and platform-level APIs, `@zynthjs/ui` provides a consistent styling architecture out-of-the-box.

This package manages your application's theme, colors, typography, spacing, and interaction states, allowing you to build cohesive user interfaces efficiently. It is designed to run synchronously with the underlying framework to guarantee strict performance and precise layout characteristics across iOS, Android, and Web.

## Core Architecture

The package is split into two primary responsibilities:

1. **Theming Engine**: A reactive token architecture that propagates styling configurations globally. It seamlessly delegates system appearance changes (e.g., toggling between light and dark modes) directly from native OS listeners into your SolidJS reactive graph.
2. **Component Abstractions**: Intelligent wrappers around `@zynthjs/components`. Components like `Text`, `Button`, or `Card` inherently implement the global theme context, meaning you rarely have to explicitly style standard components.

## Technical Capabilities

* **System Appearance Sync**: Automatically reacts to native platform configuration switches via `TraitCollection` (iOS) and `Configuration` (Android) changes.
* **Granular Reactivity**: Theming relies strictly on SolidJS signal propagation, minimizing unnecessary re-renders when token styles change globally.
* **Component Modularity**: Provides unified interfaces for complex UI elements like toggles, sliders, badges, and QR codes while keeping logic decoupled from layout concerns.
* **Platform Consistency**: Standardizes spacing, radii, and typographic tokens that visually adapt to the specific screen densities and aspect ratios of your deployment targets.

## Quick Overview

Instead of applying disjointed styles across the application, `@zynthjs/ui` components subscribe to an environment-level provider.

```tsx
import { UIProvider, Card, Text, Button } from "@zynthjs/ui";
import { View } from "@zynthjs/components";

function ApplicationRoot() {
  return (
    <UIProvider colorScheme="system">
      <View style={{ flex: 1, padding: 20 }}>
        <Card variant="elevated">
          <Text variant="heading">Overview</Text>
          <Text color="muted">This card inherits the global design tokens.</Text>
          <Button title="Confirm" tone="primary" />
        </Card>
      </View>
    </UIProvider>
  );
}
```

## Available Features

* **Design Tokens**: Configuration options for typography, spacing scales, border radii, and extensive semantic color palettes.
* **Theme Hooks**: Methods like `useUITheme()` and `createUIColorScheme()` for applying the design system to raw, structural components.
* **Pre-built Interfaces**: `Card`, `Badge`, `Button`, `Switch`, `Checkbox`, `Radio`, and `QRCode` modules ready for adoption.

Detailed documentation for theming configuration, system hooks, and individual component references can be found in the subsequent documentation files within the structure.