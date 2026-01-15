# @zynth/bottom-sheet

A high-performance, native bottom sheet component for Zynth.

This component wraps the platform's native sheet presentation (e.g., `UISheetPresentationController` on iOS) or a high-fidelity native implementation on Android to provide a smooth, gesture-driven bottom sheet experience.

## Features

*   **Native Performance**: Animations and gestures run on the native thread (Yoga/Core Animation), ensuring 60fps even with heavy JS load.
*   **Snap Points**: Define multiple height percentages (e.g., `["25%", "50%", "90%"]`) for the sheet to snap to.
*   **Backdrop**: Configurable overlay color and opacity.
*   **Controller**: Imperative API to open, close, or snap to specific indices.

## Usage

### Basic

```tsx
import { BottomSheet, View, Text } from "@zynth/bottom-sheet";

function MySheet() {
  return (
    <BottomSheet
      snapPoints={["50%", "90%"]}
      defaultOpen={true}
    >
      <View style={{ padding: 20 }}>
        <Text>Hello from the sheet!</Text>
      </View>
    </BottomSheet>
  );
}
```

### Controlled with Controller

```tsx
import { BottomSheet, createBottomSheetController, Button } from "@zynth/bottom-sheet";

function MyComponent() {
  const controller = createBottomSheetController();

  return (
    <>
      <Button onPress={() => controller.open()}>Open Sheet</Button>
      
      <BottomSheet
        controller={controller}
        snapPoints={["25%", "50%"]}
      >
        <Button onPress={() => controller.close()}>Close</Button>
      </BottomSheet>
    </>
  );
}
```

## API Reference

### `BottomSheetProps`

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `snapPoints` | `(number \| string)[]` | `["40%", "83%"]` | Array of snap points (e.g. `[200, "50%"]`). |
| `initialSnapIndex` | `number` | `0` | Index of the snap point to start at. |
| `open` | `boolean` | `undefined` | Controlled open state. |
| `defaultOpen` | `boolean` | `false` | Initial open state (uncontrolled). |
| `showOverlay` | `boolean` | `true` | Whether to show the backdrop overlay. |
| `overlayColor` | `string` | `undefined` | Color of the backdrop. |
| `overlayOpacity` | `number` | `undefined` | Opacity of the backdrop. |
| `dismissOnOverlayPress` | `boolean` | `true` | Close sheet when backdrop is pressed. |
| `allowSwipeToDismiss` | `boolean` | `true` | Allow dragging down to close. |
| `onOpenChange` | `(open: boolean) => void` | - | Callback when open state changes. |
| `onSnapIndexChange` | `(index: number) => void` | - | Callback when snap index changes. |

### `BottomSheetController`

Created via `createBottomSheetController()`.

*   `open(index?: number)`: Opens the sheet, optionally to a specific snap index.
*   `close()`: Closes the sheet.
*   `snapTo(index: number)`: Snaps the sheet to the specified index in the `snapPoints` array.
*   `getCurrentIndex()`: Returns the current snap index.