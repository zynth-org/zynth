# @zynth/async-storage

Asynchronous, unencrypted key-value storage.

This package provides a simple, persistent storage system for your app. It is similar to `localStorage` on the web but is asynchronous and persists across app restarts. It uses native implementations for performance.

> **Note:** For sensitive data like passwords or tokens, use `@zynth/secure-store` instead.

## Features

*   **Standard API**: `getItem`, `setItem`, `removeItem`, `clear`, `getAllKeys`.
*   **Reactivity**: Includes a SolidJS signal adapter (`createAsyncStorageSignal`) for reactive state persistence.
*   **Hooks**: `useAsyncStorage` for easy consumption in components.

## Usage

### Basic

```tsx
import AsyncStorage from "@zynth/async-storage";

// Save
await AsyncStorage.setItem("theme", "dark");

// Load
const theme = await AsyncStorage.getItem("theme");
```

### Reactive Signal

Create a signal that automatically persists to storage.

```tsx
import { createAsyncStorageSignal } from "@zynth/async-storage";

const [theme, setTheme] = createAsyncStorageSignal("theme", "light");

// Update persists to disk
setTheme("dark");
```
