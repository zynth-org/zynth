# FileIntents

System-level file integration for Zynth applications, enabling "Open In", "Share", and "Export to System" capabilities.

`@zynthjs/file-intents` allows your application to interact with other apps on the device by passing file references via native intents. It leverages the **Activity View Controller** on iOS and **Intents with FileProvider** on Android.

## Basic usage

### Opening a File

The `openAsync` method triggers the system's "Open In" menu, allowing the user to choose an external application to view or edit the file.

```tsx
import { FileIntents } from "@zynthjs/file-intents";

const viewPdf = async (uri: string) => {
  await FileIntents.openAsync({
    uri,
    mimeType: "application/pdf"
  });
};
```

### Sharing Content

The `shareAsync` method invokes the native system share sheet. You can share multiple files, raw text, or both.

```tsx
const shareLogs = async (logUri: string) => {
  await FileIntents.shareAsync({
    files: [{ uri: logUri, filename: "app-logs.txt" }],
    text: "Check out these logs from my Zynth app!",
    subject: "App Diagnostics"
  });
};
```

## Advanced

### Exporting to Files or Downloads

Use `exportAsync` to prompt the user to save a file from your app's sandbox to a permanent location like the "Downloads" folder or "iCloud Drive".

```tsx
const saveDocument = async (tempUri: string) => {
  const result = await FileIntents.exportAsync({
    uri: tempUri,
    suggestedName: "Official_Report.pdf",
    target: "downloads" // Or "files"
  });

  if (!result.cancelled) {
    console.log("File exported to:", result.destinationUri);
  }
};
```

## Special cases

- **iOS Platform Nuance**: On iOS, both `openAsync` and `shareAsync` utilize the system-level interaction sheet (`UIDocumentInteractionController` and `UIActivityViewController` respectively). Functionally, this means `openAsync` presents the "Copy to / Open in" menu, which is similar to the standard share sheet but prioritized for document handling.
- **App Sandbox Restriction**: For security reasons, Zynth restricts `FileIntents` to files located within the application's secure sandbox (Internal Files or Cache). Attempting to open or share files located outside these directories (e.g., system root) will result in a `SecurityException`.
- **Native Implementation**:
  - On **iOS**, successful sharing and opening use `UIActivityViewController` and `UIDocumentInteractionController`. Exporting uses the `UIDocumentPickerViewController` with `.forExporting`.
  - On **Android**, the library uses a built-in `FileProvider` to safely grant temporary URI access to the receiving application. No manual `AndroidManifest` or `app.json` configuration is required for `FileIntents` to function.
- **URI Schemes**: Only `file://` and `content://` (Android) URIs are supported. Passing `http://` or `https://` URLs to these methods will result in an error; use `@zynthjs/network` or `@zynthjs/webview` for remote URLs.

## API Reference

### `FileIntents` Methods

- `openAsync(options: OpenFileOptions): Promise<void>`
- `shareAsync(options: ShareFilesOptions): Promise<void>`
- `exportAsync(options: ExportFileOptions): Promise<ExportFileResult>`
- `isAvailable(): boolean`

### `ExportFileOptions` (Type)

- `uri: string`: Local URI of the file to export.
- `suggestedName?: string`: Default filename provided to the user.
- `target?: 'files' | 'downloads'`: Preferred destination (Downloads is Android only; iOS defaults to Files).
- `mimeType?: string`: Explicit MIME type for the exported file.
