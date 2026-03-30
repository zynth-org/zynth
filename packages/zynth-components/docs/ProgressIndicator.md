# ProgressIndicator

`ProgressIndicator` is a native loading primitive that displays an indeterminate progress spinner. It maps to `UIActivityIndicatorView` on iOS and `ProgressBar` on Android, ensuring consistent native visual patterns for loading states.

## Basic Usage

The component is at its simplest as a small, animated spinner.

```tsx
import { ProgressIndicator, View } from "@zynth/components";

function LoadingView() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ProgressIndicator size="small" />
    </View>
  );
}
```

## Resizing and Coloring

You can choose between `small` and `large` sizes and apply a custom hex `color` to brand the spinner.

```tsx
<ProgressIndicator 
  size="large" 
  color="#3498db" // Modern blue
/>
```

## Controlling Animation

If the loading process is paused or the spinner needs to be displayed in a static state, use the `animating` prop to toggle the rotation.

```tsx
<ProgressIndicator 
  size="small" 
  animating={isDataLoading()} 
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `color` | `string` | The hex color of the spinner (defaults to system gray). |
| `size` | `small \| large` | The physical dimensions of the indicator. |
| `animating` | `boolean` | Controls whether the indicator is rotating. |
| `style` | `Style` | Styling for the indicator's container. |
| `testID` | `string` | Unique identifier for automation testing. |
