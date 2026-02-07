# @zynth/document-picker

Pick files/documents from the system picker on iOS and Android.

This package opens the native document picker, returns file metadata, and can copy selected files into the app cache directory so they can be read immediately by `@zynth/filesystem`.

## Features

- Select one or many files
- Filter by MIME type / UTType identifier
- Returns file `uri`, `name`, `mimeType`, and `size`
- Optional `copyToCacheDirectory` behavior (enabled by default)

## Usage

```ts
import { DocumentPicker } from "@zynth/document-picker";

const result = await DocumentPicker.getDocumentAsync({
  multiple: true,
  type: ["image/*", "application/pdf"],
  copyToCacheDirectory: true,
});

if (!result.cancelled) {
  console.log(result.assets);
}
```

## API

### `DocumentPicker.getDocumentAsync(options?)`

Returns:

- `{ cancelled: true, assets: [] }` if user cancels
- `{ cancelled: false, assets: DocumentPickerAsset[] }` on success

Options:

- `multiple?: boolean`
- `type?: string | string[]`
- `copyToCacheDirectory?: boolean` (default: `true`)

### `DocumentPicker.isAvailable()`

Returns whether the native module bridge is available on the current platform/runtime.
