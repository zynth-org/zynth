# WebBrowser

The `WebBrowser` module provides a unified API for opening secure, in-app web browser sessions across iOS, Android, and Web platforms. By utilizing `SFSafariViewController` on iOS and `CustomTabs` on Android, it ensures that web content is rendering within a secure context that shares cookies and session data with the system browser when appropriate.

This module is designed with security as a primary focus and is the recommended underlying primitive for authentication workflows, securely interfacing with OAuth providers when used alongside `@zynth/auth-session`.

## Basic usage

The most common use case is opening a URL in an in-app browser. The module handles platform-specific capabilities automatically.

```tsx
import { WebBrowser } from "@zynth/web-browser";
import { Button } from "@zynth/ui";

export function ExternalLink() {
  const handlePress = async () => {
    const result = await WebBrowser.openBrowserAsync({
      url: "https://zynthai.com"
    });

    if (result.type === "opened") {
      ZynthLogger.debug("Browser opened successfully");
    }
  };

  return <Button title="Open Website" onPress={handlePress} />;
}
```

## Advanced usage and authentication

When implementing secure authentication flows, such as OAuth, `WebBrowser` can be integrated directly. However, for robust session management, it is recommended to pair it with `@zynth/auth-session`.

### Browser warming (Android)

To reduce the initiation time of opening a Custom Tab on Android, you can warm up the browser process before the user interaction occurs. This is safe to run on iOS and Web, where it functions as a no-op.

```tsx
import { onMount, onCleanup } from "solid-js";
import { WebBrowser } from "@zynth/web-browser";

export function BrowserPreloader() {
  onMount(() => {
    void WebBrowser.warmUpAsync();
  });

  onCleanup(() => {
    void WebBrowser.coolDownAsync();
  });

  return null;
}
```

### Dismissing the browser programmatically

In authentication flows, you might need to dismiss the browser programmatically after capturing a redirect URI within your app's event listeners.

```tsx
import { WebBrowser } from "@zynth/web-browser";

async function completeAuthFlow() {
  const result = await WebBrowser.dismissBrowser();
  if (result.dismissed) {
    ZynthLogger.debug("Browser dismissed programmatically.");
  }
}
```

## Special Cases

### Multi-Target Availability

`WebBrowser` defaults to native implementations but safely falls back to standard `window.open` APIs on Web targets. You can verify availability at runtime using `isAvailable()`.

```tsx
if (!WebBrowser.isAvailable()) {
  ZynthLogger.debug("Browser functionality is not supported on this environment.");
}
```

### Platform-Specific Visuals

Options like `toolbarColor` can provide branding continuity into the browser session but rely on underlying platform support (primarily Android). If the platform rejects the specific style configuration, the browser will safely fall back to the system defaults without breaking the prompt.

## API Reference

### `openBrowserAsync`

Opens the provided URL in an in-app browser session.

**Type**

```ts
function openBrowserAsync(options: OpenBrowserOptions): Promise<WebBrowserResult>;
```

**Parameters**

*   `options` (`OpenBrowserOptions`): Configuration for the browser session.
    *   `url` (`string`): The destination HTTP or HTTPS URL to open. *(Required)*
    *   `preferEphemeralSession` (`boolean`, optional): Suggests that the browser should not share cookies or history with the system browser (iOS).
    *   `toolbarColor` (`string`, optional): Color of the browser toolbar, provided as a hex string.
    *   `controlsColor` (`string`, optional): Color of the browser controls.
    *   `showTitle` (`boolean`, optional): Whether to display the page title in the toolbar.
    *   `enableBarCollapsing` (`boolean`, optional): Enables the toolbar to collapse when scrolling down the page.
    *   `createTask` (`boolean`, optional): If true, launches the browser in a new Android task (`FLAG_ACTIVITY_NEW_TASK`).

**Returns**

Returns a `Promise` resolving to a `WebBrowserResult` denoting the outcome.

### `WebBrowserResult`

An object containing the outcome of the browser session.

*   `type` (`"opened" | "cancel" | "dismiss" | "error"`): The termination state of the request.
*   `url` (`string`, optional): The original URL opened.
*   `errorCode` (`string`, optional): The specific error code if `type` is `"error"`.
*   `errorMessage` (`string`, optional): The error description if `type` is `"error"`.

### `dismissBrowser`

Programmatically dismisses an active WebBrowser session.

**Type**

```ts
function dismissBrowser(): Promise<WebBrowserDismissResult>;
```

**Returns**

A `Promise` that resolves to an object with a `dismissed` boolean, indicating if a browser was successfully closed.

### `warmUpAsync`

Warms up the browser process on Android prior to navigation to accelerate link loading.

**Type**

```ts
function warmUpAsync(): Promise<void>;
```

### `coolDownAsync`

Cools down the browser process on Android, releasing allocated resources.

**Type**

```ts
function coolDownAsync(): Promise<void>;
```

### `isAvailable`

Checks if the browser API is supported on the current device and execution environment.

**Type**

```ts
function isAvailable(): boolean;
```
