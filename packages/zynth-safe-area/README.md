# @zynth/safe-area

Safe area handling for Zynth applications.

This package helps you handle safe area insets (notches, home indicators, status bars) on modern mobile devices. It provides a `SafeAreaProvider` to query the native safe area metrics and components/hooks to consume them.

## Features

*   **Provider**: `SafeAreaProvider` injects safe area context into the app.
*   **Hooks**: `createSafeAreaInsets` gives reactive access to top, bottom, left, and right insets.
*   **Components**: `SafeAreaView` automatically applies padding/margin to respect safe areas.

## Usage

### Setup

Wrap your application root with the provider.

```tsx
import { SafeAreaProvider } from "@zynth/safe-area";

function App() {
  return (
    <SafeAreaProvider>
      <MyContent />
    </SafeAreaProvider>
  );
}
```

### Hook

```tsx
import { createSafeAreaInsets } from "@zynth/safe-area";

function Header() {
  const insets = createSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets().top, height: 60 + insets().top }}>
      <Text>Header Content</Text>
    </View>
  );
}
```

### Component

```tsx
import { SafeAreaView } from "@zynth/safe-area";

function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Text>Safe Content</Text>
    </SafeAreaView>
  );
}
```