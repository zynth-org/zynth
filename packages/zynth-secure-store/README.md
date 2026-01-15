# @zynth/secure-store

Encrypt and store sensitive data on the device.

This package provides an API to store key-value pairs securely using the native Keychain (iOS) and Keystore/SharedPreferences (Android). It is ideal for storing authentication tokens, secrets, or sensitive user preferences.

## Features

*   **Encryption**: Data is encrypted at rest using platform-native security.
*   **Accessibility**: Configure when data can be accessed (e.g., only when unlocked).
*   **Simple API**: `setItem`, `getItem`, `deleteItem`.

## Usage

```tsx
import * as SecureStore from "@zynth/secure-store";

// Save
await SecureStore.setItemAsync("user_token", "secret-token-123");

// Retrieve
const token = await SecureStore.getItemAsync("user_token");

// Delete
await SecureStore.deleteItemAsync("user_token");
```

## Options

You can specify keychain accessibility options:

```tsx
import * as SecureStore from "@zynth/secure-store";

await SecureStore.setItemAsync("secret", "value", {
  keychainAccessibility: SecureStore.WHEN_UNLOCKED
});
```
