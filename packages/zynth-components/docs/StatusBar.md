# StatusBar

`StatusBar` is a utility primitive for managing the device's system status bar appearance. It controls aspects like content contrast (e.g., light-content vs dark-content), background color on supporting platforms, and visibility state with native animation support.

## Basic Usage

The component is non-visual in the traditional UI tree but provides instructions to the system interface.

```tsx
import { StatusBar, View, Text } from "@zynth/components";

function Screen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#121212" }}>
      {/* Light content bar for dark screens */}
      <StatusBar 
        barStyle="light-content" 
        backgroundColor="#121212" 
        animated={true} 
      />
      
      <Text style={{ color: "white" }}>Dark Mode Content</Text>
    </View>
  );
}
```

## Content Styles

The `barStyle` prop determines the contrast of the system text and icons:

- `default`: Platform-standard style.
- `light-content`: White text/icons for dark backgrounds.
- `dark-content`: Dark text/icons for light backgrounds.

```tsx
<StatusBar barStyle="dark-content" />
```

## Visibility and Transitions

Toggle full-screen experiences by setting the `hidden` prop. On iOS, you can also specify the `showHideTransition` for the entrance and exit of the status bar.

```tsx
<StatusBar 
  hidden={true} 
  showHideTransition="slide" 
  animated={true} 
/>
```

## Android Background Configuration

On Android, the `backgroundColor` prop can be used to set a specific identity for the status bar area, allowing it to blend seamlessly with the app's top navigation theme.

```tsx
<StatusBar 
  backgroundColor="#3b82f6" 
  barStyle="light-content" 
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `barStyle` | `default \| light-content \| dark-content`| Contrasting style for system content. |
| `backgroundColor`| `string` | Hex color for the background (Android-only). |
| `animated` | `boolean` | Transition appearance changes (default: true). |
| `hidden` | `boolean` | Visibility state of the overall bar. |
| `showHideTransition`| `none \| fade \| slide` | Animation for visibility toggles (iOS-only). |

## Behavior Notes

If multiple `StatusBar` components are mounted simultaneously (e.g., in a nested navigation stack), the last component to be mounted or updated will determine the active system properties. It is recommended to mount only one `StatusBar` per active view to maintain predictable behavior.
