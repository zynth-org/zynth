# Media Library

Providing secure, cross-platform access to save images and videos into the system's native Photos or Gallery applications.

The `@zynth/media-library` package offers a high-level API for exporting media assets from your application's sandbox to the user's permanent media storage. It leverages modern platform APIs—`PHPhotoLibrary` with add-only support on iOS and scoped `MediaStore` on Android—to ensure that your app only requests the minimum necessary permissions.

Before using any Media Library features, you must declare the required permissions and usage descriptions in your `app.json` configuration file.

```json
{
  "zynth": {
    "ios": {
      "infoPlist": {
        "NSPhotoLibraryAddUsageDescription": "This app needs permission to save photos to your gallery."
      }
    },
    "android": {
      "permissions": [
        "android.permission.WRITE_EXTERNAL_STORAGE"
      ]
    }
  }
}
```
> [!NOTE]
> On Android 10 (API 29) and above, `WRITE_EXTERNAL_STORAGE` is not required for saving media to the public collections via `MediaStore`. However, including it ensures compatibility with older devices.

## Quick Start

### Saving an Image

```tsx
import { MediaLibrary } from "@zynth/media-library";
import { View, Button, Text } from "@zynth/components";

const SaveButton = (props: { imageUri: string }) => {
  const handleSave = async () => {
    // Request add-only permissions (minimum required for exporting)
    const { granted } = await MediaLibrary.requestPermissionsAsync({ 
      writeOnly: true 
    });

    if (granted) {
      try {
        await MediaLibrary.saveImageAsync({ uri: props.imageUri });
        console.log("Image saved successfully!");
      } catch (e) {
        console.error("Failed to save image:", e.message);
      }
    }
  };

  return (
    <Button onPress={handleSave}>
      <Text style={{ color: "#FFFFFF" }}>Save to Gallery</Text>
    </Button>
  );
};
```

### Advanced Album Management

The `album` property allows you to specify a target collection name. On Android, this creates a subfolder in the Pictures/Movies directory; on iOS, it suggests a target bucket for the asset.

```tsx
await MediaLibrary.saveVideoAsync({
  uri: "file:///path/to/my/video.mp4",
  album: "User Creativity"
});
```

## Platform Support

| Feature | iOS (Photos Framework) | Android (MediaStore) |
| :--- | :---: | :---: |
| **Save Image** | [x] | [x] |
| **Save Video** | [x] | [x] |
| **Add-Only Permissions** | [x] | [x] |
| **Album Support** | [x] | [x] |

## Special cases and notes

- **Permissions (iOS)**: If you only need to save media (and not read the user's library), use `NSPhotoLibraryAddUsageDescription`. This triggers a more restricted permission prompt that users are more likely to accept.
- **URI Restrictions**: For security reasons, the API only accepts local file URIs (e.g., `file:///...`). To save a remote image, you must first download it to the temporary directory using `@zynth/filesystem`.
- **Sandbox Security**: The native implementation strictly enforces sandbox checks. Any attempt to save files from outside the application's authorized directories or the temporary cache will be rejected.
- **MIME Type Detection**: Android uses the file extension to automatically derive the correct MIME type for the `MediaStore` entry. Ensure your input URIs have correct extensions (`.jpg`, `.png`, `.mp4`).

## API Reference

**Exports:** MediaLibrary, MediaLibraryPermissionResponse, RequestPermissionsOptions, SaveMediaOptions, SaveMediaResult.

### `MediaLibrary` (Static)

- `isAvailable(): boolean`
  Returns true if the native module is loaded and available.
- `getPermissionsAsync(options?: RequestPermissionsOptions): Promise<MediaLibraryPermissionResponse>`
  Returns the current permission status without prompting.
- `requestPermissionsAsync(options?: RequestPermissionsOptions): Promise<MediaLibraryPermissionResponse>`
  Prompts the user for permission.
- `saveImageAsync(options: SaveMediaOptions): Promise<SaveMediaResult>`
  Exports an image to the system gallery.
- `saveVideoAsync(options: SaveMediaOptions): Promise<SaveMediaResult>`
  Exports a video to the system gallery.

### `SaveMediaOptions`

- `uri: string` — Local file URI to the asset.
- `album?: string` — Optional name for the target album or directory.

---

This package focuses on exporting media. For capturing new photos or selecting existing ones for use within your app, see `@zynth/image-picker`.
