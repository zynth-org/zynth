# @rune/haptics

Native haptic feedback for iOS and Android.

This package provides a way to trigger haptic feedback (vibrations) on the device to improve user experience and provide tactile confirmation for actions.

## Features

*   **Notification Feedback**: Success, Warning, and Error patterns.
*   **Impact Feedback**: Light, Medium, Heavy, Soft, and Rigid styles.
*   **Selection Feedback**: Light haptic for scroll pickers or item selection.
*   **Android-Specific**: Access to low-level Android `HapticFeedbackConstants`.

## Usage

### Impact

```tsx
import { impactAsync, ImpactFeedbackStyle } from "@rune/haptics";

// Trigger a medium impact
await impactAsync(ImpactFeedbackStyle.Medium);
```

### Notification

```tsx
import { notificationAsync, NotificationFeedbackType } from "@rune/haptics";

// Success haptic
await notificationAsync(NotificationFeedbackType.Success);
```

### Selection

```tsx
import { selectionAsync } from "@rune/haptics";

await selectionAsync();
```
