# Popover

`Popover` is a context-aware container that displays floating content relative to a trigger or anchor. It manages automatic positioning, arrow indicators, and coordinate-based anchoring while maintaining native performance.

## Basic Usage

The component uses a sub-component pattern including `Popover.Trigger` and `Popover.Content`.

```tsx
import { Popover, View, Text, Button } from "@zynth/components";

function ProfilePopover() {
  return (
    <Popover showArrow={true}>
      <Popover.Trigger>
        <Button label="Click for Profile" />
      </Popover.Trigger>

      <Popover.Content style={{ width: 150, padding: 12 }}>
        <Text>User Profile</Text>
        <Text>Settings</Text>
        <Text>Logout</Text>
      </Popover.Content>
    </Popover>
  );
}
```

## Coordinate and Anchor Targeting

For popovers that aren't triggered by a child, use `Popover.open` via an imperative `ref`. You can specify fixed coordinates (`x`, `y`) or a separate `anchorRef`.

```tsx
const popoverRef = createPopoverRef();

// Opening at specific screen coordinates
popoverRef.open({ x: 100, y: 200 });

// Opening relative to another component
popoverRef.open({ anchorRef: otherComponentRef });

<Popover ref={popoverRef}>
  <Popover.Content>{/* Content */}</Popover.Content>
</Popover>
```

## Styling the Popover Container

The `Popover.style` prop maps directly to native surface attributes for optimal responsiveness:

- `backgroundColor` -> `surfaceColor`
- `borderRadius` -> `cornerRadius`
- `elevation`/`shadowRadius` -> `elevation`

```tsx
<Popover 
  style={{ 
    backgroundColor: "#F3F4F6", 
    borderRadius: 16, 
    elevation: 4 
  }}
>
  <Popover.Trigger>{/* Element */}</Popover.Trigger>
  <Popover.Content>{/* Element */}</Popover.Content>
</Popover>
```

## Positioning Offsets

Fine-tune the placement of the popover relative to its anchor using `offsetX` and `offsetY`.

```tsx
<Popover 
  offsetX={0} 
  offsetY={8} // 8px below the trigger
>
  <Popover.Trigger>{/* Element */}</Popover.Trigger>
  <Popover.Content>{/* Element */}</Popover.Content>
</Popover>
```

## Components

### Popover
The root container that manages positioning and visibility logic.

| Prop | Type | Description |
|---|---|---|
| `style` | `Style` | Native surface styling (color, radius, elevation). |
| `showArrow` | `boolean` | Display a directional arrow pointing to the anchor. |
| `offsetX` / `offsetY` | `number` | Fine-tuning for the popover's position. |
| `onOpen` / `onClose`| `() => void` | Event triggered on visibility changes. |
| `dismissOnOutsidePress`| `boolean` | Tapping outside the popover closes it (default: true). |

### Popover.Trigger
Identifies the element that activates the popover when tapped.

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | The interactive trigger source. |
| `style` | `Style` | Layout styling for the trigger area. |

### Popover.Content
Contains the elements to be displayed inside the popover.

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | The floating content. |
| `style` | `Style` | Sizing styling for the popup container. |

## Imperative Ref

The `PopoverRef` allows programmatic control over the popover's visibility:

- `open(options)`: Shows the popover. Options include `anchorRef`, `anchorNodeId`, `x`, and `y`.
- `dismiss()`: Programmatically closes the popover.
