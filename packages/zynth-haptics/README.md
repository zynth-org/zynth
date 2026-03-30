# Haptics

`Haptics` provides a cross-platform API for triggering tactile feedback on device hardware. It abstracts native feedback generators into a unified interface, supporting standard patterns such as impacts, notifications, and selection ticks.

By utilizing platform-native engines—the Taptic Engine on iOS and the `Vibrator` service on Android—`Haptics` ensures that feedback feels consistent with the host OS. A fallback to the Web Vibration API is provided for compatible browsers, enabling basic tactile interaction in web contexts.

## Basic usage

Trigger tactile feedback by calling one of the asynchronous feedback functions. These functions are safe to call on all platforms and will gracefully degrade if haptics are unsupported or unavailable.

```tsx
import { View } from "@zynth/components";
import { impactAsync, ImpactFeedbackStyle } from "@zynth/haptics";

const Button = (props) => {
  const handlePress = async () => {
    // Trigger a subtle haptic before starting the action
    await impactAsync(ImpactFeedbackStyle.Light);
    props.onPress?.();
  };

  return (
    <View onPress={handlePress} style={props.style}>
      {props.children}
    </View>
  );
};
```

## Advanced examples

### Notification Feedback

Use notification haptics to provide tactile confirmation for the outcome of an operation. This is particularly effective for background tasks or form submissions.

```tsx
import { notificationAsync, NotificationFeedbackType } from "@zynth/haptics";

const submitForm = async () => {
  try {
    await api.save();
    await notificationAsync(NotificationFeedbackType.Success);
  } catch (e) {
    await notificationAsync(NotificationFeedbackType.Error);
  }
};
```

### Android System Constants

For Android-specific applications requiring precise system interaction, `performAndroidHapticsAsync` provides access to the full range of `HapticFeedbackConstants`.

```tsx
import { performAndroidHapticsAsync, AndroidHaptics } from "@zynth/haptics";

const onLongPress = () => {
  // Use the native Android long-press pattern
  performAndroidHapticsAsync(AndroidHaptics.Long_Press);
};
```

### Selection Feedback

Selection haptics are designed for use during continuous interactions, such as scrolling through a list or adjusting a slider.

```tsx
import { selectionAsync } from "@zynth/haptics";

const onValueChange = () => {
  // Provides a light 'tick' sensation frequently used in pickers
  selectionAsync();
};
```

## Special cases and notes

- **Permissions (Android)**: To use haptic feedback on Android, the `android.permission.VIBRATE` permission must be included in your `AndroidManifest.xml` or defined in the `permissions` array of your `app.json`.
- **Platform Constraints (iOS)**: Haptic feedback requires a device equipped with a Taptic Engine (iPhone 7 and later). Older devices or those with the standard vibration motor will ignore these calls.
- **Web Limitations**: Most browsers require an active user gesture (such as a click or touch) to trigger the Vibration API. Calls made without a prior user interaction will be ignored by the browser's security model.
- **Performance**: Haptic calls are non-blocking on the JavaScript thread; however, frequent calls (e.g., in a high-frequency loop) should be avoided to prevent overwhelming the device's vibration hardware.

## API Reference

**Exports:** notificationAsync, impactAsync, selectionAsync, performAndroidHapticsAsync, NotificationFeedbackType, ImpactFeedbackStyle, AndroidHaptics.

**Functions**

- `notificationAsync(type: NotificationFeedbackType): Promise<void>`
- `impactAsync(style: ImpactFeedbackStyle): Promise<void>`
- `selectionAsync(): Promise<void>`
- `performAndroidHapticsAsync(type: AndroidHaptics): Promise<void>` (Android only)

**NotificationFeedbackType** (Enum)

- `Success` — Indicates a successful operation.
- `Warning` — Indicates a warning or that a transition is nearly complete.
- `Error` — Indicates a failure or a critical error.

**ImpactFeedbackStyle** (Enum)

- `Light` — Subtle impact.
- `Medium` — Moderate impact (default).
- `Heavy` — Strong impact.
- `Soft` — Gentle, low-frequency impact.
- `Rigid` — Abrupt, high-frequency impact.

**AndroidHaptics** (Enum)

Provides mapping to native `HapticFeedbackConstants`, including:

- `Clock_Tick`, `Confirm`, `Context_Click`, `Drag_Start`, `Gesture_Start`, `Long_Press`, `Keyboard_Tap`, `Toggle_On`, `Toggle_Off`, and others.

---

This package provides essential physical feedback for interactive applications. For gestures that trigger haptics, it is often used within callbacks from `@zynth/gesture-handler`.
