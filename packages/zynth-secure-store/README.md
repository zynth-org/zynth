# Secure Store

`@zynth/secure-store` provides encrypted key-value storage for sensitive application data on iOS and Android.

On iOS, it stores values in the Keychain. On Android, it uses encrypted shared preferences backed by the Android Keystore. The API supports both asynchronous and synchronous access, optional biometric or device authentication, and multiple storage namespaces through service identifiers.

Web is not supported by this package. `SecureStore.isAvailableAsync()` returns `false` when the native module is not available.

## Basic usage

### Store, read, and delete a value

```ts
import { SecureStore } from "@zynth/secure-store";

await SecureStore.setItemAsync("session_token", "secret-token");

const token = await SecureStore.getItemAsync("session_token");

await SecureStore.deleteItemAsync("session_token");
```

### Synchronous access

```ts
import { SecureStore } from "@zynth/secure-store";

SecureStore.setItem("launch_flag", "ready");

const flag = SecureStore.getItem("launch_flag");

SecureStore.deleteItem("launch_flag");
```

## Advanced examples

### Require authentication before access

Use `requireAuthentication` when a value should only be read or written after biometric or device authentication.

```ts
import { SecureStore } from "@zynth/secure-store";

await SecureStore.setItemAsync(
  "saved_credentials",
  JSON.stringify({ username: "alice", token: "abc123" }),
  {
    requireAuthentication: true,
    authenticationPrompt: "Authenticate to save your session",
  },
);

const credentials = await SecureStore.getItemAsync("saved_credentials", {
  requireAuthentication: true,
  authenticationPrompt: "Authenticate to access your saved session",
});
```

### Check biometric support

```ts
import { SecureStore } from "@zynth/secure-store";

const secureStoreAvailable = await SecureStore.isAvailableAsync();
const biometricsAvailable = await SecureStore.canUseBiometricAuthentication();
```

### Use a custom service namespace

`keychainService` separates stored values into different logical stores.

```ts
import { SecureStore } from "@zynth/secure-store";

await SecureStore.setItemAsync("refresh_token", "token-value", {
  keychainService: "com.example.auth",
});

const refreshToken = await SecureStore.getItemAsync("refresh_token", {
  keychainService: "com.example.auth",
});
```

### Configure iOS keychain accessibility

Accessibility constants control when a Keychain item becomes available on iOS.

```ts
import {
  SecureStore,
  WHEN_UNLOCKED,
  AFTER_FIRST_UNLOCK,
} from "@zynth/secure-store";

await SecureStore.setItemAsync("api_secret", "value", {
  keychainAccessible: WHEN_UNLOCKED,
});

await SecureStore.setItemAsync("background_token", "value", {
  keychainAccessible: AFTER_FIRST_UNLOCK,
});
```

### Use the default export

```ts
import SecureStore from "@zynth/secure-store";

const value = await SecureStore.getItemAsync("user_id");
```

## Special cases and unusual features

- This package supports iOS and Android. Web is not supported.
- Keys must be non-empty strings. Values must be strings. Passing any other type throws in JavaScript before the native call is made.
- `getItemAsync()` and `getItem()` return `null` when a key is not present.
- `setItemAsync()` and `deleteItemAsync()` resolve with no value on success.
- Synchronous methods are available: `getItem`, `setItem`, and `deleteItem`. They throw if the native module is unavailable.
- `requireAuthentication` protects reads and writes, not only reads.
- When `requireAuthentication` is enabled and no `authenticationPrompt` is provided, the native layer supplies a default prompt message.
- On iOS, `keychainAccessible` maps to Keychain accessibility classes.
- On iOS, `accessGroup` can be used to read and write shared Keychain entries when the app is configured for Keychain access groups.
- On Android, `keychainService` selects the encrypted shared-preferences file and backing key alias used by the module.
- On Android, `accessGroup` and `keychainAccessible` are accepted by the JavaScript API but are not used by the native implementation.
- `canUseBiometricAuthentication()` checks whether strong biometric authentication is available on the current device.
- Native storage availability is reported as available on iOS and Android when the module is installed correctly. If the package is missing or the native project has not been regenerated, calls will fail with a native-module error.

## API reference

### `SecureStore`

- `getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>`
- `setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>`
- `deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>`
- `getItem(key: string, options?: SecureStoreOptions): string | null`
- `setItem(key: string, value: string, options?: SecureStoreOptions): void`
- `deleteItem(key: string, options?: SecureStoreOptions): void`
- `isAvailableAsync(): Promise<boolean>`
- `canUseBiometricAuthentication(): Promise<boolean>`

### `SecureStoreOptions`

- `accessGroup?: string`
- `authenticationPrompt?: string`
- `keychainAccessible?: KeychainAccessibilityConstant`
- `keychainService?: string`
- `requireAuthentication?: boolean`

### Accessibility constants

- `WHEN_UNLOCKED`
- `AFTER_FIRST_UNLOCK`
- `ALWAYS`
- `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`
- `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
- `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`
- `ALWAYS_THIS_DEVICE_ONLY`

### `KeychainAccessibilityConstant`

Numeric constant type used by `keychainAccessible`.
