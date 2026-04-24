# Image Picker

Capturing and selecting images from the device library or camera using a high-performance, platform-native interface.

The `@zynthjs/image-picker` provides a unified, cross-platform API for interacting with the device's camera and photo library. It abstracts native UI flows (UIImagePickerController on iOS and the modern `PickVisualMedia` contract on Android) while handling asynchronous results and temporary file storage.

Before using any Image Picker features, you must declare the required permissions and usage descriptions in your `app.json` configuration file.

```json
{
  "zynth": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "This app needs access to your camera to take photos.",
        "NSPhotoLibraryUsageDescription": "This app needs access to your photo library to pick photos."
      }
    },
    "android": {
      "features": [
        { "name": "android.hardware.camera", "required": false }
      ],
      "permissions": [
        "android.permission.CAMERA"
      ]
    }
  }
}
```

> [!IMPORTANT]
> **Google Play Privacy Policy**: If you include `android.permission.CAMERA`, Google Play **requires** you to provide a Privacy Policy URL in the Google Play Console (App Content -> Privacy Policy). Failing to do so will result in a warning or rejection.

## Quick Start

### Capturing from Camera

```tsx
import { ImagePicker } from "@zynthjs/image-picker";
import { View, Button, Text } from "@zynthjs/components";

const SimplePicker = () => {
  const pickPhoto = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return;

    const result = await ImagePicker.launchCameraAsync();
    
    if (!result.cancelled && result.uri) {
      console.log("Image picked:", result.uri);
    }
  };

  return (
    <View style={{ padding: 16 }}>
      <Button onPress={pickPhoto}>
        <Text style={{ color: "#FFFFFF" }}>Update Photo</Text>
      </Button>
    </View>
  );
};
```

### Advanced Permission Checks

You can check whether permissions have been previously granted without triggering a system prompt—useful for building custom onboarding flows.

```tsx
import { createSignal, onMount } from "solid-js";
import { ImagePicker } from "@zynthjs/image-picker";

const App = () => {
  const [canAsk, setCanAsk] = createSignal(true);

  onMount(async () => {
    const { canAskAgain } = await ImagePicker.getCameraPermissionsAsync();
    setCanAsk(canAskAgain);
  });

  return (
    <View>
      {!canAsk() && <Text>Camera access is permanently disabled in system settings.</Text>}
    </View>
  );
};
```

## Platform Support

| Feature | iOS (UIKit) | Android (MediaContract) |
| :--- | :---: | :---: |
| **Launch Camera** | [x] | [x] |
| **Pick from Library** | [x] | [x] |
| **Permissions Check** | [x] | [x] |
| **Temporary URIs** | [x] | [x] |

## Special cases and notes

- **Permissions (iOS)**: Usage descriptions (Info.plist) are REQUIRED for both camera and photo library access. Calls made without these will cause the app to crash during submittal or development.
- **Permissions (Android)**: The `android.permission.CAMERA` permission must be requested. Additionally, a `FileProvider` is used internally for data exchange; the framework handles the manifest entry for you based on the `imagePickerProvider` configuration in `app.json`.
- **File Lifecycle**: Assets are stored in the application's temporary cache directory. These files may be purged by the system to reclaim disk space. Use `@zynthjs/filesystem` to move files to the documents directory for persistent storage.
- **Hardware Fallbacks**: Some devices or simulators (especially older iPad Pro models or early Android emulators) may not have a physical camera. Always check hardware status or handle `launchCameraAsync` errors gracefully.

## API Reference

**Exports:** ImagePicker, ImagePickerOptions, ImagePickerResult, PermissionResponse.

### `ImagePicker` (Static)

- `getCameraPermissionsAsync(): Promise<PermissionResponse>`
- `requestCameraPermissionsAsync(): Promise<PermissionResponse>`
- `launchCameraAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>`
- `launchImageLibraryAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>`

### `ImagePickerResult`

- `cancelled: boolean` — True if the picker was dismissed.
- `uri?: string` — The local URI of the captured image.
- `error?: string` — Optional error message if the operation failed.

---

This package provides a standardized, high-performance way to access visual media. For advanced video manipulation or saving to the gallery, see `@zynthjs/media-library`. For document selection (PDFs, Zip, etc.), see `@zynthjs/document-picker`.
