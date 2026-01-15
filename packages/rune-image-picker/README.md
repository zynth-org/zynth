# @rune/image-picker

Select images from the device library or take new photos with the camera.

This package provides a simple interface to access the device's camera and photo library, handling permissions and returning URI-based results for selected assets.

## Features

*   **Camera Support**: Launch the native camera to capture new photos.
*   **Photo Library**: Browse and select existing images from the system gallery.
*   **Permissions**: Helper methods to check and request camera/library permissions.

## Usage

### Permissions

```tsx
import { ImagePicker } from "@rune/image-picker";

const { granted } = await ImagePicker.requestCameraPermissionsAsync();
if (!granted) {
  alert("Permission to access camera is required!");
}
```

### Launching the Camera

```tsx
import { ImagePicker } from "@rune/image-picker";

const result = await ImagePicker.launchCameraAsync();

if (!result.cancelled) {
  console.log("Photo URI:", result.uri);
}
```

### Selecting from Library

```tsx
const result = await ImagePicker.launchImageLibraryAsync();
```
