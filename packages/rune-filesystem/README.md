# Rune FileSystem

File and directory helpers for Rune apps, modeled after modern filesystem APIs with Rune-native bridges.

## Installation

```bash
yarn add @rune/filesystem
```

## Quick Start

```ts
import { File, Directory, Paths, createFileSignal } from "@rune/filesystem";

const notes = new File(Paths.document, "notes.txt");
await notes.write("Hello Rune");
const text = await notes.text();

const cacheDir = new Directory(Paths.cache, "images");
await cacheDir.create({ intermediates: true, idempotent: true });
const entries = await cacheDir.list();

const signal = createFileSignal(notes, { initialValue: "" });
```

## Concepts

- `File` and `Directory` are lightweight references. They do not need to exist when created.
- All paths are URIs. Use `Paths.document`, `Paths.cache`, and `Paths.bundle` as roots.
- On Android, `Paths.bundle` is an `asset://` URI and is read-only.

## API

### File

Create a file reference:

```ts
const file = new File(Paths.document, "data.json");
```

Properties:

- `uri` (read-only) – file URI
- `name` – file name
- `extension` – file extension (e.g. `.json`)
- `parentDirectory` – parent `Directory`
- `exists` – boolean, file existence check
- `size` – file size in bytes (0 when missing)
- `creationTime` – ms since epoch or null
- `modificationTime` – ms since epoch or null
- `md5` – md5 hash or null
- `type` – mime type or empty string

Methods:

- `info(options?)` → `Promise<FileInfo>`
- `infoSync(options?)` → `FileInfo`
- `text()` / `textSync()` → file content as string
- `base64()` / `base64Sync()` → file content as base64
- `bytes()` / `bytesSync()` → file content as `Uint8Array`
- `arrayBuffer()` → `ArrayBuffer`
- `write(content)` → write string or bytes
- `create(options?)` → create file
- `delete()` → delete file
- `copy(destination)` → copy to directory or file
- `move(destination)` → move to directory or file
- `rename(newName)` → rename within current directory
- `readableStream()` / `stream()` → readable stream (in-memory)
- `writableStream()` → writable stream (in-memory)

Static:

- `File.downloadFileAsync(url, destination, options?)` → download using `fetch`
- `File.pickFileAsync(...)` → not implemented yet (throws)

### Directory

Create a directory reference:

```ts
const directory = new Directory(Paths.cache, "images");
```

Properties:

- `uri` (read-only) – directory URI
- `name` – directory name
- `parentDirectory` – parent `Directory`
- `exists` – boolean, directory existence check
- `size` – directory size in bytes or null

Methods:

- `info()` / `infoSync()` → `DirectoryInfo`
- `list()` → list contents as `File | Directory`
- `create(options?)` → create directory
- `createDirectory(name)` → child `Directory`
- `createFile(name, mimeType?)` → child `File`
- `delete()` → delete directory (recursive)
- `copy(destination)` → copy to directory or file
- `move(destination)` → move to directory or file
- `rename(newName)` → rename within current directory

Static:

- `Directory.pickDirectoryAsync(...)` → not implemented yet (throws)

### Paths

`Paths` exposes platform directories and basic path utilities.

Properties:

- `Paths.document` → `Directory`
- `Paths.cache` → `Directory`
- `Paths.bundle` → `Directory` (read-only on Android)
- `Paths.availableDiskSpace` → bytes available
- `Paths.totalDiskSpace` → total bytes
- `Paths.appleSharedContainers` → map of shared container directories (iOS only, empty otherwise)

Methods:

- `basename(path, ext?)`
- `dirname(path)`
- `extname(path)`
- `isAbsolute(path)`
- `join(...paths)`
- `normalize(path)`
- `parse(path)` → `{ root, dir, base, ext, name }`
- `relative(from, to)`
- `info(...uris)` → `PathInfo` or `PathInfo[]`

### Signals (SolidJS)

#### createFileSignal

```ts
const signal = createFileSignal(new File(Paths.document, "note.txt"), {
  initialValue: "",
  read: async () => file.text(),
  write: async (value) => file.write(value),
});
```

Returns:

- `value()` – current value
- `loading()` – read state
- `error()` – last error
- `refresh()` – re-read from disk
- `setValue(nextValue)` – write and update
- `remove()` – delete file and reset to initial value

#### createDirectorySignal

```ts
const signal = createDirectorySignal(new Directory(Paths.cache, "images"));
```

Returns:

- `entries()` – `File | Directory` list
- `loading()` – read state
- `error()` – last error
- `refresh()` – re-list directory

## Types

- `FileInfo`, `DirectoryInfo`, `PathInfo`
- `FileCreateOptions`, `DirectoryCreateOptions`, `InfoOptions`, `DownloadOptions`

## Platform Notes

- `Paths.bundle` is `file://` on iOS and `asset://` on Android.
- Asset URIs are read-only.
- Streams are implemented in-memory for now.
- File and directory pickers are not implemented yet.
