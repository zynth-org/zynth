# Modal

`Modal` is a primitive component for displaying full-screen content over the main application interface. It utilizes native window management to ensure that overlaid content is isolated and responds correctly to system-level dismissals and dimension changes.

## Basic Usage

The component can be used in a controlled manner using the `open` prop and the `onDismiss` callback.

```tsx
import { Modal, View, Text, Button } from "@zynthjs/components";

function InfoModal() {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <>
      <Button onPress={() => setIsOpen(true)} label="Open Details" />

      <Modal 
        open={isOpen()} 
        onDismiss={() => setIsOpen(false)}
        animation="slide"
      >
        <View style={{ flex: 1, backgroundColor: "white", padding: 40 }}>
          <Text>Detailed Information</Text>
          <Button onPress={() => setIsOpen(false)} label="Close" />
        </View>
      </Modal>
    </>
  );
}
```

## Overlay and Transparency

By default, the modal covers the entire screen. For dialog-style interfaces, enable `transparent` and customize the `overlayColor` and `overlayOpacity`.

```tsx
<Modal
  transparent={true}
  overlayColor="#000"
  overlayOpacity={0.6}
  dismissOnOverlayPress={true}
>
  <View style={{ 
    margin: 40, 
    padding: 20, 
    borderRadius: 12, 
    backgroundColor: "white",
    alignSelf: "center" 
  }}>
    <Text>Confirmation Dialog</Text>
  </View>
</Modal>
```

## Animation Variants

`Modal` supports several native transition styles to match the application's aesthetic:

- `fade`: Smooth opacity transition (default).
- `slide`: Vertical slide-in from the bottom.
- `zoom`: Scale-up transition from the center.
- `none`: Instant appearance.

```tsx
<Modal animation="zoom" open={isVisible()}>
  <View>{/* Modal content */}</View>
</Modal>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Controlled visibility state. |
| `defaultOpen` | `boolean` | Initial open state for uncontrolled usage. |
| `animation` | `fade \| slide \| zoom \| none`| Transition style. |
| `transparent` | `boolean` | Whether the modal should show the content behind it. |
| `overlayColor` | `string` | Hex color for the backdrop coating. |
| `overlayOpacity` | `number` | Alpha level for the backdrop (0 to 1). |
| `dismissOnOverlayPress`| `boolean` | Enables tap-to-close on the backdrop. |
| `onRequestClose` | `() => void` | Triggered by system-level close requests. |
| `onDismiss` | `() => void` | Triggered when the modal completes its dismissal. |
| `onOpenChange` | `(open: boolean) => void` | Triggered when visibility toggles. |
| `style` | `Style` | Container styling. |

## Imperative Ref

For advanced scenarios, `createModalRef` can be used to manage the modal instance without maintaining specialized Boolean signals.

```tsx
const modalRef = createModalRef();

// Triggers native show sequence
modalRef.open();

// Triggers native dismiss sequence
modalRef.dismiss();
```
