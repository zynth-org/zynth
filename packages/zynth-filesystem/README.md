# FileSystem

FileSystem exposes a compact, cross-platform API for working with files and directories from application code. It provides synchronous metadata accessors, asynchronous I/O (text, bytes, base64), streaming primitives for large files, upload/download helpers, and SolidJS-compatible signals for integrating file state into UI components.

Basic platform support is provided for iOS and Android. Web runtimes have partial support for some operations (for example, download helpers and stream-based APIs that rely on `fetch`).

## Basic usage

### File interaction

```tsx
import { File, Paths } from "@zynth/filesystem";

// Create a file relative to the app documents directory
const note = new File(Paths.document.uri, "notes.txt");

// Write and read text
await note.write("hello world");
const text = await note.text();

// Sync checks and metadata
if (note.exists) {
  console.log(note.size, note.modificationTime);
}
```

### Directory enumeration

```ts
import { Directory, File, Paths } from "@zynth/filesystem";

const cacheLogs = new Directory(Paths.cache.uri, "logs");
if (!cacheLogs.exists) {
  await cacheLogs.create({ intermediates: true });
}
const entries = await cacheLogs.list();
const files = entries.filter((e) => e instanceof File) as File[];
```

## Advanced examples

### Reactive file-backed signal (SolidJS)

```tsx
import { createEffect } from "solid-js";
import { File, Paths, createFileSignal } from "@zynth/filesystem";

const configFile = new File(Paths.document.uri, "config.json");

const App = () => {
  const { value, loading, setValue } = createFileSignal(configFile, {
    initialValue: '{"theme":"system"}',
  });

  createEffect(() => {
    if (!loading()) {
      const parsed = JSON.parse(value());
      console.log("theme:", parsed.theme);
    }
  });

  return (
    <div>
      <div>{loading() ? "Loading..." : JSON.parse(value()).theme}</div>
      <button onClick={() => setValue(JSON.stringify({ theme: "dark" }))}>
        Set Dark
      </button>
    </div>
  );
};
```

### Streaming reads and uploads

```ts
// Read file as a stream and upload using fetch
const f = new File(Paths.document.uri, "large.bin");
const response = await f.uploadAsync("https://upload.example.com/part", {
  method: "PUT",
  onUploadProgress: (p) => console.log(p.bytesSent, p.bytesTotal),
  checksum: "sha256",
});

// Alternatively: consume chunks using the readable stream
const reader = f.readableStream().getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // process Uint8Array chunk
}
```

### Download helper

```ts
// Download a remote URL into the given directory
const downloadsDir = new Directory(Paths.document.uri, "downloads");
const saved = await File.downloadFileAsync(
  "https://example.com/file.zip",
  downloadsDir,
  { idempotent: true },
);
console.log(saved.uri);
```

## Special cases and notes

- Paths.bundle is read-only and intended for immutable compiled assets; write operations on bundle paths will fail.
- All file and directory URIs are normalized internally; use `Paths` helpers for path arithmetic and inspection.
- Signals (`createFileSignal`, `createDirectorySignal`) return SolidJS-compatible getters (`value()`, `loading()`, `entries()`) so they can be used directly inside Solid components.
- Some runtime-dependent features (native uploads, checksums, and certain sync metadata calls) require the native platform module. Where the native bridge is unavailable, operations that rely on it will throw — check runtime availability before calling these methods in non-native environments.
- Methods like `write`, `move`, and `create` are implemented as atomic operations on supported platforms to reduce the risk of data corruption during unexpected termination.

## API Reference

**Exports:** File, Directory, Paths, createFileSignal, createDirectorySignal and the types listed below.

**File** (class)

- `new File(...segments: PathLike[])` — Construct a file URI from path segments.
- `uri: string` — Full resource URI.
- `name: string` — Basename of the file.
- `extension: string` — File extension.
- `parentDirectory: Directory` — Parent directory object.
- `exists: boolean` — Synchronous existence check.
- `size: number` — Synchronous size (0 if missing).
- `creationTime: number | null` — Synchronous creation timestamp.
- `modificationTime: number | null` — Synchronous modification timestamp.
- `md5: string | null` — Synchronous MD5 if available.
- `type: string` — MIME-like type when available.
- `info(options?: InfoOptions): Promise<FileInfo>` — Async metadata.
- `infoSync(options?: InfoOptions): FileInfo` — Sync metadata.
- `text(): Promise<string>` / `textSync(): string` — Read UTF-8 text.
- `bytes(): Promise<Uint8Array>` / `bytesSync(): Uint8Array` — Read raw bytes.
- `base64(): Promise<string>` / `base64Sync(): string` — Read base64-encoded contents.
- `arrayBuffer(): Promise<ArrayBuffer>` — Read as ArrayBuffer.
- `checksumAsync(algo?: ChecksumAlgorithm): Promise<string>` / `checksumSync(algo?: ChecksumAlgorithm): string` — Compute checksum.
- `write(content: string | Uint8Array): Promise<void>` — Atomic write.
- `create(options?: FileCreateOptions): Promise<void>` — Create an empty file.
- `delete(): Promise<void>` — Remove file.
- `copy(destination: Directory | File | string): Promise<void>` — Copy file.
- `move(destination: Directory | File | string): Promise<void>` — Move file (updates instance URI).
- `rename(newName: string): Promise<void>` — Rename within parent directory.
- `uploadStream(options?: UploadStreamOptions): ReadableStream<Uint8Array>` — Stream readable chunks from file.
- `readableStream()` / `stream()` — Alias for `uploadStream`.
- `writableStream(): WritableStream<Uint8Array>` — Writable stream that writes on close.
- `uploadAsync(url: string, options?: UploadOptions): Promise<Response>` — Upload using `fetch` with optional progress and checksum.
- `static downloadFileAsync(url: string, destination: Directory | File | string, options?: DownloadOptions): Promise<File>` — Download to destination.

**Directory** (class)

- `new Directory(...segments: PathLike[])` — Construct a directory URI.
- `uri: string` — Full directory URI.
- `name: string` — Directory basename.
- `parentDirectory: Directory` — Parent directory.
- `exists: boolean` — Synchronous existence check.
- `size: number | null` — Synchronous size when available.
- `info(): Promise<DirectoryInfo>` / `infoSync(): DirectoryInfo` — Metadata.
- `list(): Promise<Array<File | Directory>>` — Enumerate entries.
- `create(options?: DirectoryCreateOptions): Promise<void>` — Create directory.
- `createDirectory(name: string): Directory` — Helper to construct child directory.
- `createFile(name: string, _mimeType?: string | null): File` — Helper to construct child file.
- `delete(): Promise<void>` — Recursive deletion.
- `copy(destination: Directory | File | string): Promise<void>` — Copy directory.
- `move(destination: Directory | File | string): Promise<void>` — Move directory.
- `rename(newName: string): Promise<void>` — Rename directory.

**Paths** (static helpers)

- `Paths.document: Directory` — Application documents directory.
- `Paths.cache: Directory` — Cache directory.
- `Paths.bundle: Directory` — Read-only application bundle assets.
- `Paths.appleSharedContainers: Record<string, Directory>` — Shared containers (iOS when applicable).
- `Paths.availableDiskSpace: number` — Available bytes.
- `Paths.totalDiskSpace: number` — Total bytes.
- `Paths.basename(path: PathLike, ext?: string): string`
- `Paths.dirname(path: PathLike): string`
- `Paths.extname(path: PathLike): string`
- `Paths.isAbsolute(path: PathLike): boolean`
- `Paths.join(...paths: PathLike[]): string`
- `Paths.normalize(path: PathLike): string`
- `Paths.parse(path: PathLike)` — Returns `{ base, dir, ext, name, root }`.
- `Paths.relative(from: PathLike, to: PathLike): string`
- `Paths.info(...uris: PathLike[]): PathInfo | PathInfo[]` — Path metadata snapshot.

**Signals (reusability with SolidJS)**

- `createFileSignal<T>(file: File, options: FileSignalOptions<T>): FileSignal<T>` — Returns `{ value(), loading(), error(), refresh(), setValue(), remove() }`.
- `createDirectorySignal<T = File | Directory>(directory: Directory, options?: DirectorySignalOptions<T>): DirectorySignal<T>` — Returns `{ entries(), loading(), error(), refresh() }`.

**Types** (selected)

- `PathLike = string | { uri: string }`
- `FileInfo`, `DirectoryInfo`, `DirectoryEntryInfo` — Metadata shapes.
- `UploadOptions`, `UploadStreamOptions`, `UploadChecksumOptions` — Upload configuration.
- `FileSignalOptions<T>`, `FileSignal<T>`, `DirectorySignalOptions<T>`, `DirectorySignal<T>` — Signal types used by the reactive helpers.

---

This document covers the public surface exported from the package entry. Use `Paths` helpers for portable path manipulation and the `File`/`Directory` classes for most I/O. Signals are provided to integrate file state into SolidJS-based UI code.
