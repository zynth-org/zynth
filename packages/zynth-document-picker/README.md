# DocumentPicker

Native document and file selection system for Zynth applications, providing a unified interface for the system's file explorers.

`@zynthjs/document-picker` leverages **UIDocumentPickerViewController** on iOS and the **Storage Access Framework (SAF)** on Android to allow users to select files from their device, iCloud, or Google Drive.

## Basic usage

### Picking a single document

The `getDocumentAsync` method opens the system's document picker. It resolves with a result object containing the selected file's metadata or a cancelled state.

```tsx
import { DocumentPicker } from "@zynthjs/document-picker";

const pickFile = async () => {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/pdf", // Optional: filter by MIME type
    copyToCacheDirectory: true // Optional: copy file to internal cache
  });

  if (!result.cancelled) {
    const asset = result.assets[0];
    console.log("File URI:", asset.uri);
    console.log("File Name:", asset.name);
    console.log("File Size:", asset.size);
  }
};
```

## Advanced

### Picking Multiple Files

You can allow users to select multiple documents at once by enabling the `multiple` option.

```tsx
const pickMultiple = async () => {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    type: ["image/*", "application/pdf"]
  });

  if (!result.cancelled) {
    result.assets.forEach(asset => {
      console.log(`Picked: ${asset.name} (${asset.mimeType})`);
    });
  }
};
```

### Filtering by Type

The `type` option accepts MIME types. On iOS, these are automatically converted to **UTTypes** for system compatibility.

- `*/*`: All files (default).
- `image/*`: All images.
- `application/pdf`: PDF files.
- `text/plain`: Text files.

## Special cases

- **Caching Behavior**: By default, `copyToCacheDirectory` is `true`. 
  - On **iOS**, the file is copied to a temporary directory using `FileManager` to ensure the app has persistent read access (resolving security-scope resource issues).
  - On **Android**, the content is read from the `ContentResolver` and written to the app's internal cache directory. 
  - If set to `false`, the returned URI is the original system URI (e.g., `content://` on Android). Note that these URIs may require special permissions or may not be accessible after the app is restarted.
- **Large Files**: File discovery and metadata reading are performed on native background threads to prevent UI freezes. However, reading or copying extremely large files (e.g., GB-sized videos) will still be limited by the device's I/O and available cache space.
- **Native Implementation**: 
  - On **iOS**, it uses `UIDocumentPickerViewController` with `.item` or specific `UTType` filters.
  - On **Android**, it uses `Intent.ACTION_OPEN_DOCUMENT` which provides access to all document providers (Downloads, Drive, SD Card).

## API Reference

### `DocumentPicker` Methods

- `getDocumentAsync(options?: DocumentPickerOptions): Promise<DocumentPickerResult>`
- `isAvailable(): boolean`

### `DocumentPickerAsset` (Type)

- `uri: string`: The URI to the selected file.
- `name: string | null`: The display name of the file.
- `mimeType: string | null`: The MIME type of the file.
- `size: number | null`: The size of the file in bytes.
