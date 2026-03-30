# Alert

`Alert` is a cross-platform component for displaying modal dialogs. It maps directly to `UIAlertController` on iOS and Material 3 `AlertDialog` on Android, ensuring consistent native behavior for critical user interactions.

## Basic Usage

The component is designed to be triggered via an imperative reference. This allows for clean separation between the UI logic and the dialog presentation.

```tsx
import { Alert, createAlertRef, Button } from "@zynth/components";

function DeletionManager() {
  const alertRef = createAlertRef();

  const handleDelete = () => {
    console.log("Item deleted");
  };

  return (
    <>
      <Button onPress={() => alertRef.show()}>Delete Item</Button>
      
      <Alert
        ref={alertRef}
        title="Confirm Deletion"
        message="This action cannot be undone. Are you sure you want to proceed?"
        buttons={[
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: handleDelete }
        ]}
      />
    </>
  );
}
```

## Button Styles

`Alert` supports three native button styles that are mapped to the platform's standard visual cues:

- `default`: The standard action button.
- `cancel`: Specialized styling for dismissal actions (e.g., bold on iOS).
- `destructive`: Styling indicating a dangerous or permanent action (e.g., red text).

## Multi-Button Layouts

To maintain cross-platform parity, `Alert` is limited to a maximum of 3 buttons. 

- **1 Button**: Standard acknowledgement dialog (e.g., "OK").
- **2 Buttons**: Choice between two actions (e.g., "Cancel", "Confirm").
- **3 Buttons**: Advanced choice (e.g., "Save", "Discard", "Cancel").

## Props

| Prop | Type | Description |
|---|---|---|
| `title` | `string` | The bold header text. |
| `message` | `string` | Secondary descriptive text. |
| `buttons` | `AlertButtons` | A list of 1 to 3 `AlertButton` objects. |
| `onDismiss` | `() => void` | Triggered when the alert is closed by any means. |
| `ref` | `(node) => void` | Reference for imperative control. |

### AlertButton Object

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Button label. |
| `style` | `default` \| `cancel` \| `destructive` | Native visual treatment. |
| `onPress` | `() => void` | Callback triggered when the button is tapped. |

## Imperative Ref

The `AlertRef` provides methods to control the dialog visibility programmatically:

- `show()`: Displays the alert.
- `dismiss()`: Programmatically closes the alert.
