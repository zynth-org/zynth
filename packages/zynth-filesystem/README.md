# @zynth/filesystem

Full-featured native filesystem access for Zynth.

This package provides a robust API for interacting with the device's local filesystem, including file reading/writing, directory management, metadata retrieval, and persistent reactive signals.

## Features

*   **Path Management**: Easy access to standard locations like `Documents`, `Cache`, and `AppData`.
*   **File & Directory API**: Intuitive classes for CRUD operations on files and folders.
*   **Reactive Signals**: `createFileSignal` and `createDirectorySignal` keep your UI in sync with the disk state.
*   **Streaming & Encoding**: Supports UTF-8, Base64, and binary data.

## Usage

### Paths

```tsx
import { Paths } from "@zynth/filesystem";

console.log(Paths.documentDirectory); // Native path to app documents
```

### Writing/Reading Files

```tsx
import { File } from "@zynth/filesystem";

const myFile = File.at(Paths.documentDirectory + "/hello.txt");

await myFile.writeContentsAsync("Hello Zynth!");
const content = await myFile.readContentsAsync();
```

### Reactive Filesystem

```tsx
import { createFileSignal } from "@zynth/filesystem";

const [config, setConfig] = createFileSignal(
  Paths.documentDirectory + "/config.json",
  { theme: "light" }
);

// Updating the signal automatically writes to the file
setConfig({ theme: "dark" });
```