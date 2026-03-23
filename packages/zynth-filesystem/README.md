# @zynth/filesystem

Native filesystem access for Zynth apps.

`@zynth/filesystem` combines:

- `File` and `Directory` classes for common file operations
- `Paths` helpers for app-scoped locations and path utilities
- Solid-friendly signal wrappers for reactive file/directory state
- Streamed upload helpers (`uploadAsync`, `uploadStream`) for large files
- Native checksum helpers (`md5`, `sha1`, `sha256`)

It intentionally does not own system picker UX. Use `@zynth/document-picker` in app code, then wrap returned URIs with `File`/`Directory`.

## Basic

### Install

```bash
npm i @zynth/filesystem
```

Regenerate native projects after adding the package.

### Basic usage

```ts
import { File, Paths } from "@zynth/filesystem";

const file = new File(Paths.document, "notes.txt");
await file.create({ intermediates: true });
await file.write("Hello Zynth");

const text = await file.text();
const info = await file.info({ md5: true });
```

### Directory usage

```ts
import { Directory, File, Paths } from "@zynth/filesystem";

const root = new Directory(Paths.document, "workspace");
await root.create({ intermediates: true, idempotent: true });

const draft = root.createFile("draft.txt");
await draft.write("first draft");

const entries = await root.list(); // Array<File | Directory>
```

### Upload helper usage

```ts
import { File, Paths } from "@zynth/filesystem";

const video = new File(Paths.document, "movie.mp4");

const response = await video.uploadAsync("https://example.com/upload", {
  method: "PUT",
  checksum: { algorithm: "sha256", headerName: "x-content-checksum" },
  tls: {
    trustedCertificatesPem: [serverCertificatePem],
  },
  onUploadProgress: (event) => {
    console.log(event.phase, event.bytesSent, event.bytesTotal);
  },
});
```

### Reactive usage (Solid)

```ts
import { File, Paths, createFileSignal } from "@zynth/filesystem";

const settingsFile = new File(Paths.document, "settings.json");

const settings = createFileSignal(settingsFile, {
  initialValue: "{}",
  read: async () => settingsFile.text(),
  write: async (next) => settingsFile.write(next),
});

await settings.setValue('{"theme":"dark"}');
```

### Picker integration

```ts
import { DocumentPicker } from "@zynth/document-picker";
import { File } from "@zynth/filesystem";

const result = await DocumentPicker.getDocumentAsync({
  multiple: false,
  copyToCacheDirectory: true,
});

if (!result.cancelled && result.assets[0]?.uri) {
  const file = new File(result.assets[0].uri);
  console.log(await file.text());
}
```

## Advanced

### Why `uploadAsync` for big files

`uploadAsync` uses `uploadStream()` internally and sends chunks to the native fetch uploader.

Benefits:

- avoids loading the whole file into JS memory
- supports upload progress events
- can attach checksum metadata headers in one call

For low-level control, use `fetch` directly with `body: file.uploadStream(...)`.

### Checksums and integrity metadata

Use `checksumAsync()` or `checksumSync()` to compute digests natively:

```ts
const sha = await file.checksumAsync("sha256");
```

Supported algorithms:

- `md5`
- `sha1`
- `sha256`

`uploadAsync` can auto-inject checksum headers:

- `checksum: "sha256"` -> defaults to `x-zynth-checksum: sha256:<digest>`
- custom object for `headerName` and prefix behavior

### TLS pinning in `uploadAsync`

For self-signed or private CA HTTPS endpoints, pass request-level trust anchors:

```ts
await file.uploadAsync("https://127.0.0.1:53317/__zynth/upload", {
  method: "POST",
  tls: {
    trustedCertificatesPem: [serverCertificatePem],
  },
});
```

Notes:

- `trustedCertificatesPem` accepts one PEM string or an array of PEM strings.
- Trust applies only to that request.
- This is intended for explicit cert pinning/private trust flows.

### Path semantics and URI support

`File`/`Directory` constructors accept path segments (`PathLike`):

- string paths (absolute or relative)
- URI objects: `{ uri: string }`
- mixed segments: `new File(Paths.cache, "a", "b.txt")`

File URIs (`file://`) are normalized by the package. `asset://` / `bundle://` are supported for reading/listing where the platform allows it.

## API reference

### `File`

Properties:

- `uri`
- `name`
- `extension`
- `parentDirectory`
- `exists`
- `size`
- `creationTime`
- `modificationTime`
- `md5`
- `type`

Info/read/write:

- `info(options?: InfoOptions): Promise<FileInfo>`
- `infoSync(options?: InfoOptions): FileInfo`
- `text(): Promise<string>`
- `textSync(): string`
- `bytes(): Promise<Uint8Array>`
- `bytesSync(): Uint8Array`
- `base64(): Promise<string>`
- `base64Sync(): string`
- `arrayBuffer(): Promise<ArrayBuffer>`
- `write(content: string | Uint8Array): Promise<void>`

Streams:

- `readableStream(): ReadableStream<Uint8Array>`
- `stream(): ReadableStream<Uint8Array>`
- `writableStream(): WritableStream<Uint8Array>`
- `uploadStream(options?: UploadStreamOptions): ReadableStream<Uint8Array>`

Upload/checksum:

- `uploadAsync(url: string, options?: UploadOptions): Promise<Response>`
- `checksumAsync(algorithm?: ChecksumAlgorithm): Promise<string>`
- `checksumSync(algorithm?: ChecksumAlgorithm): string`

Mutations:

- `create(options?: FileCreateOptions): Promise<void>`
- `delete(): Promise<void>`
- `copy(destination: Directory | File | string): Promise<void>`
- `move(destination: Directory | File | string): Promise<void>`
- `rename(newName: string): Promise<void>`

Static helpers:

- `downloadFileAsync(url, destination, options?): Promise<File>`

### `Directory`

Properties:

- `uri`
- `name`
- `parentDirectory`
- `exists`
- `size`

Methods:

- `info(): Promise<DirectoryInfo>`
- `infoSync(): DirectoryInfo`
- `list(): Promise<Array<File | Directory>>`
- `create(options?: DirectoryCreateOptions): Promise<void>`
- `createDirectory(name: string): Directory`
- `createFile(name: string, mimeType?): File`
- `delete(): Promise<void>`
- `copy(destination: Directory | File | string): Promise<void>`
- `move(destination: Directory | File | string): Promise<void>`
- `rename(newName: string): Promise<void>`

### `Paths`

Locations:

- `Paths.document: Directory`
- `Paths.cache: Directory`
- `Paths.bundle: Directory`
- `Paths.appleSharedContainers: Record<string, Directory>`

Disk space:

- `Paths.availableDiskSpace: number`
- `Paths.totalDiskSpace: number`

Path utilities:

- `basename(path, ext?)`
- `dirname(path)`
- `extname(path)`
- `isAbsolute(path)`
- `join(...paths)`
- `normalize(path)`
- `parse(path)`
- `relative(from, to)`
- `info(...uris)`

### Signals

- `createFileSignal(file, options): FileSignal<T>`
  - `value`, `loading`, `error`, `refresh`, `setValue`, `remove`
- `createDirectorySignal(directory, options?): DirectorySignal<T>`
  - `entries`, `loading`, `error`, `refresh`

### Core types

- `PathLike`
- `PathInfo`
- `FileInfo`
- `DirectoryInfo`
- `DirectoryEntryInfo`
- `FileCreateOptions`
- `DirectoryCreateOptions`
- `InfoOptions`
- `DownloadOptions`
- `ChecksumAlgorithm`
- `UploadProgress`
- `UploadStreamOptions`
- `UploadChecksumOptions`
- `UploadOptions`
- `FileSignal`, `FileSignalOptions`
- `DirectorySignal`, `DirectorySignalOptions`

## Platform notes

- iOS App Transport Security (ATS) blocks plain HTTP by default. For local testing, use loopback (`127.0.0.1`) or configure ATS exceptions.
- `asset://` and `bundle://` paths are read-only on mobile platforms. Write/create/delete/move/rename against those URIs are not supported.
