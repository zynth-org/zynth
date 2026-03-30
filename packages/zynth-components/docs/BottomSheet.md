# BottomSheet

`BottomSheet` is a highly flexible, native-driven component for displaying sheet content from the bottom of the screen. It supports multiple snap points, dynamic height detection, and complex gestures while maintaining native smoothness.

## Basic Usage

The standard `BottomSheet` employs `snapPoints` to define fixed or relative positions where the sheet can rest. It can be initialized with a default state or controlled via a Solid accessor.

```tsx
import { BottomSheet, View, Text } from "@zynth/components";

function ActionSheet() {
  return (
    <BottomSheet 
      snapPoints={["30%", "64%", "90%"]} 
      initialSnapIndex={1}
      overlayColor="#000"
      overlayOpacity={0.5}
      dismissOnOverlayPress={true}
    >
      <View style={{ padding: 24 }}>
        <Text>BottomSheet Content</Text>
      </View>
    </BottomSheet>
  );
}
```

## Dynamic Height Selection

For sheets whose content varies in length, enabling `dynamicContentHeight` allows the component to detect and apply its own height as the main snap point. This ensures the sheet is always correctly sized to fit its internal content without clipping or excess empty space.

```tsx
<BottomSheet 
  dynamicContentHeight={true} 
  allowBackgroundInteraction={false}
>
  <View style={{ padding: 24 }}>
    {/* Height will be correctly determined on mount and update */}
    <Text>Dynamic content goes here...</Text>
  </View>
</BottomSheet>
```

## Snap Point Configuration

`SnapPoint` values can be provided as absolute pixel numbers or percentage-based strings relative to the screen height.

```tsx
// Snap at 300px and 2/3 of the screen height
<BottomSheet snapPoints={[300, "66%"]} />
```

## Touch Interaction and Layering

Control how the sheet behaves during user interaction using the behavior props:

- **Overlay**: `overlayColor` and `overlayOpacity` define the backdrop visually.
- **Dismissal**: `dismissOnOverlayPress` allows tapping the backdrop to close the sheet.
- **Background**: `allowBackgroundInteraction` lets the user interact with the content behind the sheet when it is not fully expanded.

## Portal Rendering (iOS)

On iOS, `BottomSheet` automatically allocates a dedicated native surface for its content. This ensures that the sheet's rendering is isolated from the main layout tree, allowing it to move over existing view hierarchies without layout interference.

## Props

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | Content placed inside the sheet. |
| `snapPoints` | `SnapPoint[]` | Array of numbers or "N%" strings for snap positions. |
| `initialSnapIndex` | `number` | Index of the snap point to show on mount. |
| `open` | `boolean` | Controlled open state hook. |
| `dynamicContentHeight` | `boolean` | Automatic sheet height based on children size. |
| `overlayColor` | `string` | Hex value for the backdrop (default #000). |
| `overlayOpacity` | `number` | Alpha level for the backdrop (0 to 1). |
| `dismissOnOverlayPress` | `boolean` | Enables tap-to-close on the backdrop. |
| `allowBackgroundInteraction` | `boolean` | Enables touches on views behind the sheet. |
| `onOpenChange` | `(open: boolean) => void` | Triggered when sheet visibility toggles. |
| `onSnapChange` | `({index, progress}) => void`| Triggered during gestures or transitions. |
| `onDismiss` | `() => void` | Triggered when the sheet is completely closed. |
| `style` | `Style` | Sheet container styling. |
| `contentContainerStyle` | `Style` | Styling for the inner scrollable area. |

## Imperative Ref

The `ref` provides an interface to control the sheet's movement programmatically:

```tsx
const sheetRef = createBottomSheetRef();

// Triggers expansion to the highest snap point
sheetRef.expand();

// Closes the sheet entirely
sheetRef.close();

// Snaps to a specific index in snapPoints array
sheetRef.snapTo(1);
```
